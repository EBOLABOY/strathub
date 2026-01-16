/**
 * STOPPING 执行器
 * 
 * 处理 STOPPING bots：cancel open orders → STOPPED
 */

import { prisma, Prisma } from '@crypto-strategy-hub/database';
import { ORDER_PREFIX, type Balance, type TradingExecutor, type OpenOrder } from '@crypto-strategy-hub/shared';
import type { StoppingResult } from './worker.js';
import { classifyRetryableError, computeBackoffMs } from './retry.js';
import { alertCritical } from './metrics.js';
import { Decimal } from 'decimal.js';

// Re-export for backward compatibility
export type ExchangeExecutor = Pick<TradingExecutor, 'fetchOpenOrders' | 'cancelOrder' | 'createOrder' | 'fetchBalance'>;
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
        async createOrder(): Promise<{ exchangeOrderId: string; clientOrderId: string; status: string }> {
            throw new Error('NOT_IMPLEMENTED');
        },
        async fetchBalance(): Promise<Record<string, Balance>> {
            return {};
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

const CLOSE_ORDER_PREFIX = `${ORDER_PREFIX}c`;

function isForceCloseReason(lastError: string | null): lastError is string {
    return (
        typeof lastError === 'string' &&
        (lastError.startsWith('STOP_LOSS') || lastError.startsWith('TAKE_PROFIT'))
    );
}

function parseSymbolPair(symbol: string): { base: string; quote: string } | null {
    const parts = symbol.split('/');
    if (parts.length !== 2) return null;
    const base = parts[0]?.trim();
    const quote = parts[1]?.trim();
    if (!base || !quote) return null;
    return { base, quote };
}

function parseDecimalSafe(value: string | undefined, fallback: string = '0'): Decimal {
    try {
        return new Decimal(value ?? fallback);
    } catch {
        return new Decimal(fallback);
    }
}

async function submitCloseOrderIntent(input: {
    executor: ExchangeExecutor;
    order: {
        id: string;
        botId: string;
        exchange: string;
        symbol: string;
        clientOrderId: string;
        exchangeOrderId: string | null;
        type: 'market';
        amount: string;
        submittedAt: Date | null;
    };
}): Promise<{ status: string; exchangeOrderId: string } | null> {
    if (input.order.submittedAt || input.order.exchangeOrderId) {
        return null;
    }

    const now = new Date();
    const placed = await input.executor.createOrder({
        symbol: input.order.symbol,
        side: 'sell',
        type: 'market',
        amount: input.order.amount,
        clientOrderId: input.order.clientOrderId,
    });

    await prisma.order.update({
        where: {
            exchange_clientOrderId: {
                exchange: input.order.exchange,
                clientOrderId: input.order.clientOrderId,
            },
        },
        data: {
            exchangeOrderId: placed.exchangeOrderId,
            status: placed.status,
            submittedAt: now,
        },
    });

    return { status: placed.status, exchangeOrderId: placed.exchangeOrderId };
}

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
                lastError: true,
                exchangeAccount: { select: { exchange: true } },
            },
        });

        if (!bot) {
            return { success: false, error: 'Bot not found' };
        }

        if (bot.status !== 'STOPPING') {
            return { success: true }; // 已经不是 STOPPING，跳过
        }

        const needsForceClose = isForceCloseReason(bot.lastError);

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
            if (needsForceClose && order.clientOrderId.startsWith(CLOSE_ORDER_PREFIX)) {
                continue; // do not cancel force-close order
            }
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

        // 3. 强制平仓：在 STOP_LOSS/TAKE_PROFIT 下，卖出 base 资产后才允许 STOPPED
        if (needsForceClose) {
            const pair = parseSymbolPair(bot.symbol);
            if (!pair) {
                return await handleStoppingFailure({
                    botId,
                    botStatusVersion: bot.statusVersion,
                    nowMs,
                    previousAttempts: state?.attempts ?? 0,
                    error: new Error(`INVALID_SYMBOL: ${bot.symbol}`),
                    message: `INVALID_SYMBOL: ${bot.symbol}`,
                    canceledOrders,
                });
            }

            // 如果已有 close order：检查状态/必要时补提交
            const existingClose = await prisma.order.findFirst({
                where: {
                    botId,
                    clientOrderId: { startsWith: CLOSE_ORDER_PREFIX },
                },
                orderBy: [{ intentSeq: 'desc' }, { createdAt: 'desc' }],
            });

            if (existingClose?.status === 'FILLED') {
                // continue to STOPPED transition below
            } else {
                try {
                    if (existingClose) {
                        if (!existingClose.submittedAt && !existingClose.exchangeOrderId) {
                            await submitCloseOrderIntent({
                                executor,
                                order: {
                                    id: existingClose.id,
                                    botId,
                                    exchange: existingClose.exchange,
                                    symbol: existingClose.symbol,
                                    clientOrderId: existingClose.clientOrderId,
                                    exchangeOrderId: existingClose.exchangeOrderId,
                                    type: 'market',
                                    amount: existingClose.amount,
                                    submittedAt: existingClose.submittedAt,
                                },
                            });
                        }
                        return { success: true, canceledOrders };
                    }

                    // 计算需要卖出的 base 数量（全部卖出）
                    const balances = await executor.fetchBalance();
                    const freeBase = balances[pair.base]?.free ?? balances[pair.base]?.total ?? '0';
                    const baseAmount = parseDecimalSafe(freeBase);
                    if (baseAmount.lte(0)) {
                        // 没有仓位需要平，允许 STOPPED
                    } else {
                        const lastIntent = await prisma.order.findFirst({
                            where: { botId },
                            select: { intentSeq: true },
                            orderBy: [{ intentSeq: 'desc' }, { createdAt: 'desc' }],
                        });
                        const nextIntentSeq = (lastIntent?.intentSeq ?? 0) + 1;
                        const clientOrderId = `${CLOSE_ORDER_PREFIX}-${bot.id.slice(0, 8)}-${nextIntentSeq}`;

                        const created = await prisma.order.create({
                            data: {
                                botId: bot.id,
                                exchange: bot.exchangeAccount.exchange,
                                symbol: bot.symbol,
                                clientOrderId,
                                exchangeOrderId: null,
                                submittedAt: null,
                                side: 'sell',
                                type: 'market',
                                status: 'NEW',
                                price: null,
                                amount: baseAmount.toString(),
                                filledAmount: '0',
                                avgFillPrice: null,
                                intentSeq: nextIntentSeq,
                            },
                        });

                        const placed = await submitCloseOrderIntent({
                            executor,
                            order: {
                                id: created.id,
                                botId,
                                exchange: created.exchange,
                                symbol: created.symbol,
                                clientOrderId: created.clientOrderId,
                                exchangeOrderId: created.exchangeOrderId,
                                type: 'market',
                                amount: created.amount,
                                submittedAt: created.submittedAt,
                            },
                        });

                        if (!placed) {
                            return { success: true, canceledOrders };
                        }

                        if (placed.status !== 'FILLED') {
                            return { success: true, canceledOrders };
                        }
                    }
                } catch (error) {
                    return await handleStoppingFailure({
                        botId,
                        botStatusVersion: bot.statusVersion,
                        nowMs,
                        previousAttempts: state?.attempts ?? 0,
                        error,
                        message: 'FORCE_CLOSE_FAILED',
                        canceledOrders,
                    });
                }
            }
        }

        // 4. CAS 更新状态为 STOPPED
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

        // 发送严重告警：清仓失败
        void alertCritical(
            '清仓失败',
            `Bot 撤单过程中遇到不可恢复错误: ${info.message}`,
            { botId: input.botId }
        );

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
