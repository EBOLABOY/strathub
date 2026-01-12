/**
 * STOPPING 执行器
 * 
 * 处理 STOPPING bots：cancel open orders → STOPPED
 */

import { prisma, Prisma } from '@crypto-strategy-hub/database';
import type { TradingExecutor, OpenOrder } from '@crypto-strategy-hub/shared';
import type { StoppingResult } from './worker.js';

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

        // 2. 获取并撤销所有 open orders
        let canceledOrders = 0;
        let openOrders: OpenOrder[];

        try {
            openOrders = await executor.fetchOpenOrders(bot.symbol);
            console.log(`[Stopping] Bot ${botId}: found ${openOrders.length} open orders`);
        } catch (error) {
            console.error(`[Stopping] Bot ${botId}: failed to fetch open orders:`, error);
            return { success: false, error: '503 EXCHANGE_UNAVAILABLE' };
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
                return {
                    success: false,
                    error: `Failed to cancel order ${order.id}`,
                    canceledOrders,
                };
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
