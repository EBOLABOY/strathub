/**
 * Worker Deps - 运行时依赖注入
 *
 * 目标：
 * - 不依赖 api/express
 * - 复用 shared/database 的纯函数与存储
 * - Provider 统一从 `@crypto-strategy-hub/market-data` 获取（mock/real 由 env 控制）
 */

import { prisma, Prisma } from '@crypto-strategy-hub/database';
import { checkAutoClose, parseAutoCloseConfig } from '@crypto-strategy-hub/shared';
import { getProviderFactory as getMarketDataProviderFactory } from '@crypto-strategy-hub/market-data';
import type { WorkerDeps, MarketDataProvider, AutoCloseResult } from './worker.js';
import { alertWarning, recordRiskTriggered } from './metrics.js';

// ============================================================================
// checkAndTrigger 实现（复用 shared 的纯函数 + prisma 写入）
// ============================================================================

async function checkAndTriggerAutoCloseImpl(
    botId: string,
    userId: string,
    provider: MarketDataProvider
): Promise<AutoCloseResult> {
    const bot = await prisma.bot.findFirst({
        where: { id: botId, userId },
        select: {
            id: true,
            statusVersion: true,
            symbol: true,
            configJson: true,
            autoCloseReferencePrice: true,
            autoCloseTriggeredAt: true,
        },
    });

    if (!bot) {
        throw new Error('Bot not found');
    }

    if (bot.autoCloseTriggeredAt) {
        return { triggered: false, previouslyTriggered: true };
    }

    if (!bot.autoCloseReferencePrice) {
        return { triggered: false, previouslyTriggered: false };
    }

    const config = parseAutoCloseConfig(bot.configJson);
    if (!config.enableAutoClose) {
        return { triggered: false, previouslyTriggered: false };
    }

    let tickerLast: string;
    try {
        const ticker = await provider.getTicker(bot.symbol);
        tickerLast = ticker.last;
    } catch (error) {
        console.error(`[AutoClose] Failed to get ticker for ${bot.symbol}:`, error);
        throw new Error('503 EXCHANGE_UNAVAILABLE');
    }

    let decision;
    try {
        decision = checkAutoClose(config, {
            referencePrice: bot.autoCloseReferencePrice,
            lastPrice: tickerLast,
            alreadyTriggered: false,
        });
    } catch (error) {
        console.error('[AutoClose] Invalid price data from exchange');
        throw new Error('503 EXCHANGE_UNAVAILABLE');
    }

    if (!decision.shouldTrigger) {
        return { triggered: false, previouslyTriggered: false };
    }

    const now = new Date();
    try {
        await prisma.bot.update({
            where: {
                id: botId,
                statusVersion: bot.statusVersion,
                autoCloseTriggeredAt: null,
            },
            data: {
                status: 'STOPPING',
                statusVersion: bot.statusVersion + 1,
                autoCloseTriggeredAt: now,
                autoCloseReason: 'AUTO_CLOSE',
                lastError: `AUTO_CLOSE triggered: drawdown ${decision.drawdownPercent}%`,
            },
        });
    } catch (error) {
        // CAS 失败：区分“已触发”（幂等成功）vs “并发修改”
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            const currentBot = await prisma.bot.findUnique({
                where: { id: botId },
                select: { autoCloseTriggeredAt: true },
            });

            if (currentBot?.autoCloseTriggeredAt) {
                return { triggered: false, previouslyTriggered: true };
            }

            throw new Error('409 CONCURRENT_MODIFICATION');
        }

        throw error;
    }

    // 记录指标和发送告警
    recordRiskTriggered('auto_close');
    void alertWarning(
        '自动止损触发',
        `Bot 触发自动止损，回撤 ${decision.drawdownPercent}%`,
        { botId }
    );

    return { triggered: true, previouslyTriggered: false, newStatus: 'STOPPING' };
}

import { createSimulatorFactory, createRealFactory } from './executor-factory.js';
import { reconcileBot } from './reconcile.js';
import { processTriggerOrder } from './trigger-order.js';
import { createProcessStoppingBot } from './stopping-executor.js';
import type { TradingExecutor } from '@crypto-strategy-hub/shared';
import type { ProcessTriggerOrderFn, ProcessStoppingFn } from './worker.js';

// ============================================================================
// Trigger/Order 适配器
// ============================================================================

function createProcessTriggerOrderAdapter(): ProcessTriggerOrderFn {
    return async (botId, _userId, provider, executor) => {
        if (!executor) {
            console.warn(`[TriggerOrder] Bot ${botId}: no executor provided, skip`);
            return;
        }

        // 获取 bot 的 symbol
        const bot = await prisma.bot.findUnique({
            where: { id: botId },
            select: { symbol: true },
        });

        if (!bot) {
            console.warn(`[TriggerOrder] Bot ${botId}: not found, skip`);
            return;
        }

        const ticker = await provider.getTicker(bot.symbol);
        const marketInfo = await provider.getMarketInfo(bot.symbol);

        await processTriggerOrder(botId, {
            executor,
            tickerPrice: ticker.last,
            marketInfo,
        });
    };
}

// ============================================================================
// Stopping 适配器
// ============================================================================

function createProcessStoppingBotAdapter(
    executorFactory: (id: string) => Promise<{ executor: TradingExecutor }>
): ProcessStoppingFn {
    return async (botId) => {
        // 需要获取 bot 的 exchangeAccountId
        const bot = await prisma.bot.findUnique({
            where: { id: botId },
            select: { exchangeAccountId: true },
        });

        if (!bot) {
            return { success: false, error: 'Bot not found' };
        }

        const { executor } = await executorFactory(bot.exchangeAccountId);
        const processFn = createProcessStoppingBot(executor);
        return processFn(botId);
    };
}

// ============================================================================
// Export: createWorkerDeps (历史命名：返回 WorkerDeps)
// ============================================================================

export async function createWorkerDeps(): Promise<WorkerDeps> {
    const useRealExchange = process.env['WORKER_USE_REAL_EXCHANGE'] === 'true';
    const enableTrading = process.env['WORKER_ENABLE_TRADING'] === 'true';
    const enableStopping = process.env['WORKER_ENABLE_STOPPING'] === 'true';

    // Safety: never allow "real trading" driven by mock market data.
    // If you really want this, you are doing something wrong.
    if (useRealExchange && enableTrading && process.env['EXCHANGE_PROVIDER'] !== 'real') {
        throw new Error(
            'Refusing to enable real trading with EXCHANGE_PROVIDER!=real. Set EXCHANGE_PROVIDER=real or disable WORKER_ENABLE_TRADING/WORKER_USE_REAL_EXCHANGE.'
        );
    }

    if (enableTrading && !enableStopping) {
        console.warn('[Worker Deps] Trading enabled but stopping disabled: STOPPING bots will not be canceled automatically');
    }

    // 默认 Simulator，显式开启 Real
    const executorFactory = useRealExchange
        ? createRealFactory(prisma)
        : createSimulatorFactory();

    // 日志提示配置状态
    console.log(`[Worker Deps] Real Exchange: ${useRealExchange}`);
    console.log(`[Worker Deps] Trading Enabled: ${enableTrading}`);
    console.log(`[Worker Deps] Stopping Enabled: ${enableStopping}`);

    return {
        providerFactory: getMarketDataProviderFactory(),
        checkAndTriggerAutoClose: checkAndTriggerAutoCloseImpl,
        executorFactory,
        reconcileBot,
        processTriggerOrder: enableTrading ? createProcessTriggerOrderAdapter() : undefined,
        processStoppingBot: enableStopping ? createProcessStoppingBotAdapter(executorFactory) : undefined,
    };
}

