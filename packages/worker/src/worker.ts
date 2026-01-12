/**
 * Worker Loop - C1 接线版 + STOPPING 执行闭环
 * 
 * 功能：
 * - 扫描 RUNNING/WAITING_TRIGGER bots → risk-check
 * - 扫描 STOPPING bots → cancel orders → STOPPED
 * - Provider cache 有 maxSize 限制
 * - V1 假设单实例，不做 lease
 */

import { prisma } from '@crypto-strategy-hub/database';
import type {
    ExchangeAccountInfo,
    MarketDataProvider,
    MarketDataProviderFactory,
} from '@crypto-strategy-hub/market-data';

// ============================================================================
// Types
// ============================================================================

export type { MarketDataProvider, ExchangeAccountInfo } from '@crypto-strategy-hub/market-data';
export type ProviderFactory = MarketDataProviderFactory;

export interface WorkerConfig {
    intervalMs: number;
    maxBotsPerTick: number;
    providerCacheMaxSize: number;
}

export interface WorkerDeps {
    providerFactory: ProviderFactory;
    executorFactory?: ExecutorFactory;
    reconcileBot?: ReconcileFn;
    checkAndTriggerAutoClose: CheckAutoCloseFn;
    processTriggerOrder?: ProcessTriggerOrderFn;
    processStoppingBot?: ProcessStoppingFn;
}

export type ExecutorFactory = import('./executor-factory.js').ExecutorFactory;
export type ExecutorContext = import('./executor-factory.js').ExecutorContext;

export type ReconcileFn = (
    botId: string,
    deps: { executor: import('@crypto-strategy-hub/shared').TradingExecutor }
) => Promise<{ success: boolean; error?: string }>;

export type CheckAutoCloseFn = (
    botId: string,
    userId: string,
    provider: MarketDataProvider
) => Promise<AutoCloseResult>;

export type ProcessTriggerOrderFn = (
    botId: string,
    userId: string,
    provider: MarketDataProvider,
    executor?: import('@crypto-strategy-hub/shared').TradingExecutor
) => Promise<void>;

export type ProcessStoppingFn = (
    botId: string
) => Promise<StoppingResult>;

export interface AutoCloseResult {
    triggered: boolean;
    previouslyTriggered?: boolean;
    newStatus?: string;
}

export interface StoppingResult {
    success: boolean;
    newStatus?: 'STOPPED' | 'ERROR';
    canceledOrders?: number;
    error?: string;
}

// ============================================================================
// Provider Cache（LRU 简化版）
// ============================================================================

interface CacheEntry {
    provider: MarketDataProvider;
    lastUsedAt: number;
}

const providerCache = new Map<string, CacheEntry>();
let cacheMaxSize = 100;

export function setProviderCacheMaxSize(maxSize: number): void {
    cacheMaxSize = maxSize;
}

async function getOrCreateProvider(
    factory: ProviderFactory,
    account: ExchangeAccountInfo
): Promise<MarketDataProvider> {
    const cached = providerCache.get(account.id);
    if (cached) {
        cached.lastUsedAt = Date.now();
        return cached.provider;
    }

    // 超出上限时删除最旧的
    if (providerCache.size >= cacheMaxSize) {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;

        for (const [key, entry] of providerCache) {
            if (entry.lastUsedAt < oldestTime) {
                oldestTime = entry.lastUsedAt;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            providerCache.delete(oldestKey);
            console.log(`[Worker] Cache evicted: ${oldestKey}`);
        }
    }

    const provider = await factory.createProvider(account);
    providerCache.set(account.id, {
        provider,
        lastUsedAt: Date.now(),
    });

    return provider;
}

export function clearProviderCache(): void {
    providerCache.clear();
}

export function removeFromProviderCache(accountId: string): void {
    providerCache.delete(accountId);
}

// ============================================================================
// Core Logic
// ============================================================================

/**
 * 处理单个 Bot 的 risk-check
 */
export async function runOnce(
    botId: string,
    deps: WorkerDeps,
    executor?: import('@crypto-strategy-hub/shared').TradingExecutor
): Promise<{ success: boolean; error?: string }> {
    try {
        const bot = await prisma.bot.findUnique({
            where: { id: botId },
            include: { exchangeAccount: true },
        });

        if (!bot) {
            return { success: false, error: 'Bot not found' };
        }

        // 只处理 RUNNING / WAITING_TRIGGER
        if (bot.status !== 'RUNNING' && bot.status !== 'WAITING_TRIGGER') {
            return { success: true };
        }

        const provider = await getOrCreateProvider(deps.providerFactory, {
            id: bot.exchangeAccount.id,
            exchange: bot.exchangeAccount.exchange,
        });

        const result = await deps.checkAndTriggerAutoClose(
            bot.id,
            bot.userId,
            provider
        );

        // 风控触发则不再下新单
        if (result.triggered || result.newStatus === 'STOPPING') {
            console.log(`[Worker] Bot ${botId}: risk triggered, skip trigger/order`);
            return { success: true };
        }

        if (deps.processTriggerOrder) {
            await deps.processTriggerOrder(bot.id, bot.userId, provider, executor);
        }

        console.log(`[Worker] Bot ${botId}: tick done`);
        return { success: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Worker] Bot ${botId} error:`, message);
        return { success: false, error: message };
    }
}

/**
 * 批量 tick：扫描活跃 bots 和 STOPPING bots
 */
export async function tick(
    deps: WorkerDeps,
    config: WorkerConfig
): Promise<{ processed: number; errors: number; stoppingSynced: number }> {
    // 1. 扫描活跃 bots（RUNNING/WAITING_TRIGGER）
    const activeBots = await prisma.bot.findMany({
        where: {
            status: { in: ['RUNNING', 'WAITING_TRIGGER'] },
        },
        take: config.maxBotsPerTick,
        select: { id: true, exchangeAccountId: true },
    });

    console.log(`[Worker] tick: found ${activeBots.length} active bots`);

    let processed = 0;
    let errors = 0;

    for (const bot of activeBots) {
        processed++;

        // 获取 executor（如果有 factory）
        let executor: import('@crypto-strategy-hub/shared').TradingExecutor | undefined;
        if (deps.executorFactory) {
            try {
                const executorContext = await deps.executorFactory(bot.exchangeAccountId);
                executor = executorContext.executor;
            } catch (error) {
                errors++;
                const message = error instanceof Error ? error.message : String(error);
                console.error(`[Worker] Bot ${bot.id}: executorFactory error:`, message);
            }
        }

        // Reconcile first (if injected). If reconcile fails, skip risk-check for this bot.
        if (deps.reconcileBot && executor) {
            const rec = await deps.reconcileBot(bot.id, { executor });
            if (!rec.success) {
                errors++;
                continue;
            }
        }

        const result = await runOnce(bot.id, deps, executor);
        if (!result.success) {
            errors++;
        }
    }

    // 2. 扫描 STOPPING bots（如果有 processStoppingBot）
    let stoppingSynced = 0;
    if (deps.processStoppingBot) {
        const stoppingBots = await prisma.bot.findMany({
            where: { status: 'STOPPING' },
            take: config.maxBotsPerTick,
            select: { id: true },
        });

        console.log(`[Worker] tick: found ${stoppingBots.length} STOPPING bots`);

        for (const bot of stoppingBots) {
            try {
                const result = await deps.processStoppingBot(bot.id);
                if (result.success) {
                    stoppingSynced++;
                } else {
                    errors++;
                }
            } catch (error) {
                console.error(`[Worker] STOPPING bot ${bot.id} error:`, error);
                errors++;
            }
        }
    }

    return { processed, errors, stoppingSynced };
}

// ============================================================================
// Loop
// ============================================================================

let loopRunning = false;

export async function startLoop(
    deps: WorkerDeps,
    config: WorkerConfig
): Promise<void> {
    if (loopRunning) {
        console.warn('[Worker] Loop already running');
        return;
    }

    loopRunning = true;
    setProviderCacheMaxSize(config.providerCacheMaxSize);
    console.log(`[Worker] Starting loop, interval=${config.intervalMs}ms, cacheMax=${config.providerCacheMaxSize}`);

    while (loopRunning) {
        try {
            await tick(deps, config);
        } catch (error) {
            console.error('[Worker] tick error:', error);
        }

        await sleep(config.intervalMs);
    }
}

export function stopLoop(): void {
    loopRunning = false;
    console.log('[Worker] Loop stopped');
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
