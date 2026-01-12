/**
 * STOPPING 执行器
 * 
 * 处理 STOPPING bots：cancel open orders → STOPPED
 */

import { prisma, Prisma } from '@crypto-strategy-hub/database';
import type { TradingExecutor, OpenOrder } from '@crypto-strategy-hub/shared';
import type { StoppingResult } from './worker.js';
import { classifyRetryableError, computeBackoffMs } from './retry.js';

// Re-export for backward compatibility
export type ExchangeExecutor = Pick<TradingExecutor, 'fetchOpenOrders' | 'cancelOrder'>;
export type { OpenOrder };

// ============================================================================
// Mock Executor（测试用）
// ============================================================================

export function createMockExecutor(openOrders: OpenOrder[] = []): ExchangeExecutor {
    let orders = [...openOrders];

    return {
        async fetchOpenOrders(_symbol: string): Promise<OpenOrder[]> {
            return orders;
        },
        async cancelOrder(orderId: string): Promise<void> {
            orders = orders.filter((o) => o.id !== orderId);
        },
    };
}

// ============================================================================
// processStoppingBot 实现
// ============================================================================

const STOP_MAX_RETRIES = parseInt(process.env['WORKER_STOP_MAX_RETRIES'] ?? '5', 10);
const STOP_BACKOFF = {
    baseMs: parseInt(process.env['WORKER_STOP_BACKOFF_BASE_MS'] ?? '1000', 10),
    maxMs: parseInt(process.env['WORKER_STOP_BACKOFF_MAX_MS'] ?? '30000', 10),
    jitterRatio: 0.2,
} as const;

type StopRetryState = { attempts: number; nextAtMs: number };
const stopRetryState = new Map<string, StopRetryState>(); // key: botId

export function createProcessStoppingBot(
    executor: ExchangeExecutor
): (botId: string) => Promise<StoppingResult> {
    return async (botId: string): Promise<StoppingResult> => {
        // 1. 获取 bot
        const bot = await prisma.bot.findUnique({
            where: { id: botId },
            select: {
                id: true,
                symbol: true,
                status: true,
                statusVersion: true,
                runId: true,
            },
        });

        if (!bot) {
            return { success: false, error: 'Bot not found' };
        }

        if (bot.status !== 'STOPPING') {
            return { success: true }; // 已经不是 STOPPING，跳过
        }

        const nowMs = Date.now();
        const state = stopRetryState.get(botId);
        if (state && nowMs < state.nextAtMs) {
            return { success: true };
        }

        // 2. 获取并撤销所有 open orders
        let canceledOrders = 0;
        let openOrders: OpenOrder[];

        try {
            openOrders = await executor.fetchOpenOrders(bot.symbol);
            console.log(`[Stopping] Bot ${botId}: found ${openOrders.length} open orders`);
        } catch (error) {
            console.error(`[Stopping] Bot ${botId}: failed to fetch open orders:`, error);
            return await handleStoppingFailure({
                botId,
                botStatusVersion: bot.statusVersion,
                nowMs,
                previousAttempts: state?.attempts ?? 0,
                error,
                message: '503 EXCHANGE_UNAVAILABLE',
                canceledOrders,
            });
        }

        // 逐个撤销，任一失败则终止
        for (const order of openOrders) {
            try {
                await executor.cancelOrder(order.id, bot.symbol);
                canceledOrders++;
                console.log(`[Stopping] Bot ${botId}: canceled order ${order.id}`);
            } catch (error) {
                // 任一 cancel 失败 → 保持 STOPPING，下次 tick 重试
                console.error(`[Stopping] Bot ${botId}: failed to cancel order ${order.id}:`, error);
                return await handleStoppingFailure({
                    botId,
                    botStatusVersion: bot.statusVersion,
                    nowMs,
                    previousAttempts: state?.attempts ?? 0,
                    error,
                    message: `Failed to cancel order ${order.id}`,
                    canceledOrders,
                });
            }
        }

        // 3. CAS 更新状态为 STOPPED
        try {
            await prisma.bot.update({
                where: {
                    id: botId,
                    statusVersion: bot.statusVersion,
                    status: 'STOPPING',
                },
                data: {
                    status: 'STOPPED',
                    statusVersion: bot.statusVersion + 1,
                    runId: null, // 清空 runId
                    lastError: null,
                },
            });

            stopRetryState.delete(botId);

            console.log(`[Stopping] Bot ${botId}: transitioned to STOPPED`);
            return {
                success: true,
                newStatus: 'STOPPED',
                canceledOrders,
            };
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                // CAS 失败，可能已被其他进程处理
                console.log(`[Stopping] Bot ${botId}: CAS failed, already processed`);
                return { success: true }; // 幂等成功
            }
            throw error;
        }
    };
}

async function handleStoppingFailure(input: {
    botId: string;
    botStatusVersion: number;
    nowMs: number;
    previousAttempts: number;
    error: unknown;
    message: string;
    canceledOrders: number;
}): Promise<StoppingResult> {
    const info = classifyRetryableError(input.error);
    const attempt = input.previousAttempts + 1;

    if (info.retryable && attempt < STOP_MAX_RETRIES) {
        const backoffMs = computeBackoffMs(attempt, STOP_BACKOFF, info.retryAfterMs);
        stopRetryState.set(input.botId, { attempts: attempt, nextAtMs: input.nowMs + backoffMs });
        return { success: false, error: input.message, canceledOrders: input.canceledOrders };
    }

    stopRetryState.delete(input.botId);

    try {
        await prisma.bot.update({
            where: {
                id: input.botId,
                status: 'STOPPING',
                statusVersion: input.botStatusVersion,
            },
            data: {
                status: 'ERROR',
                statusVersion: input.botStatusVersion + 1,
                lastError: `STOPPING_FAILED: ${info.code ?? 'UNKNOWN'}: ${info.message}`,
            },
        });

        return {
            success: false,
            newStatus: 'ERROR',
            error: input.message,
            canceledOrders: input.canceledOrders,
        };
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            return { success: true };
        }
        throw error;
    }
}
