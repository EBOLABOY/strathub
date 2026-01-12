/**
 * Bot Executor Service
 * 
 * 实现状态机的 side effects：reconcile、cancel、清仓等
 * 
 * 来源：docs/spec/state-machine.md
 */

import { prisma } from '@crypto-strategy-hub/database';
import type { ExchangeSimulator, SimulatorOrder } from '@crypto-strategy-hub/exchange-simulator';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

export interface BotExecutorDeps {
    exchangeSimulator: ExchangeSimulator;
}

export interface ReconcileResult {
    success: boolean;
    runId: string;
    syncedOrders: number;
    syncedTrades: number;
    stateHash: string;
    error?: string;
}

export interface CancelResult {
    success: boolean;
    canceledOrders: number;
    failedOrders: number;
    errors: string[];
}

/**
 * Bot Executor
 * 
 * 负责执行状态机的 side effects
 */
export class BotExecutor {
    private readonly simulator: ExchangeSimulator;

    constructor(deps: BotExecutorDeps) {
        this.simulator = deps.exchangeSimulator;
    }

    /**
     * Reconcile：与交易所同步状态
     * 
     * 来源：docs/spec/reconcile.md
     */
    async reconcile(botId: string): Promise<ReconcileResult> {
        const runId = uuidv4();

        try {
            // Step 2: 读取本地
            const bot = await prisma.bot.findUnique({
                where: { id: botId },
            });

            if (!bot) {
                throw new Error(`Bot not found: ${botId}`);
            }

            // Step 3: 拉取远端
            const remoteOrders = await this.simulator.fetchOpenOrders(bot.symbol);
            const remoteTrades = await this.simulator.fetchMyTrades(bot.symbol);

            // Step 4: 识别"我方订单"（gb1 前缀）
            const ourOrders = remoteOrders.filter(o => o.clientOrderId.startsWith('gb1'));

            // Step 5: 对齐订单
            let syncedOrders = 0;
            for (const remoteOrder of ourOrders) {
                await prisma.order.upsert({
                    where: {
                        exchange_clientOrderId: {
                            exchange: 'binance',
                            clientOrderId: remoteOrder.clientOrderId,
                        },
                    },
                    create: {
                        botId,
                        exchange: 'binance',
                        symbol: remoteOrder.symbol,
                        clientOrderId: remoteOrder.clientOrderId,
                        exchangeOrderId: remoteOrder.exchangeOrderId,
                        side: remoteOrder.side,
                        type: remoteOrder.type,
                        status: remoteOrder.status,
                        price: remoteOrder.price,
                        amount: remoteOrder.amount,
                        filledAmount: remoteOrder.filledAmount,
                        avgFillPrice: remoteOrder.avgFillPrice,
                    },
                    update: {
                        exchangeOrderId: remoteOrder.exchangeOrderId,
                        status: remoteOrder.status,
                        filledAmount: remoteOrder.filledAmount,
                        avgFillPrice: remoteOrder.avgFillPrice,
                    },
                });
                syncedOrders++;
            }

            // Step 6: 对齐成交（幂等）
            let syncedTrades = 0;
            for (const trade of remoteTrades) {
                // 只处理 gb1 前缀的订单的成交
                if (!trade.clientOrderId?.startsWith('gb1')) continue;

                try {
                    await prisma.trade.create({
                        data: {
                            botId,
                            exchange: 'binance',
                            symbol: trade.symbol,
                            tradeId: trade.tradeId,
                            clientOrderId: trade.clientOrderId,
                            side: trade.side,
                            price: trade.price,
                            amount: trade.amount,
                            fee: trade.fee,
                            feeCurrency: trade.feeCurrency,
                            timestamp: new Date(trade.timestamp),
                        },
                    });
                    syncedTrades++;
                } catch (error) {
                    // 唯一约束冲突 = 已存在，跳过
                    if ((error as Error).message?.includes('Unique')) {
                        continue;
                    }
                    throw error;
                }
            }

            // Step 8: 落盘快照
            const stateJson = JSON.stringify({
                openOrders: ourOrders.length,
                reconciledAt: new Date().toISOString(),
            });
            const stateHash = createHash('sha256').update(stateJson).digest('hex').slice(0, 16);

            await prisma.botSnapshot.create({
                data: {
                    botId,
                    runId,
                    reconciledAt: new Date(),
                    stateJson,
                    stateHash,
                },
            });

            // 更新 bot runId
            await prisma.bot.update({
                where: { id: botId },
                data: { runId },
            });

            return {
                success: true,
                runId,
                syncedOrders,
                syncedTrades,
                stateHash,
            };
        } catch (error) {
            return {
                success: false,
                runId,
                syncedOrders: 0,
                syncedTrades: 0,
                stateHash: '',
                error: (error as Error).message,
            };
        }
    }

    /**
     * 撤销所有挂单
     */
    async cancelAllOrders(botId: string): Promise<CancelResult> {
        const bot = await prisma.bot.findUnique({
            where: { id: botId },
        });

        if (!bot) {
            return {
                success: false,
                canceledOrders: 0,
                failedOrders: 0,
                errors: [`Bot not found: ${botId}`],
            };
        }

        const openOrders = await this.simulator.fetchOpenOrders(bot.symbol);
        const ourOrders = openOrders.filter(o => o.clientOrderId.startsWith('gb1'));

        let canceledOrders = 0;
        let failedOrders = 0;
        const errors: string[] = [];

        for (const order of ourOrders) {
            try {
                await this.simulator.cancelOrder(order.exchangeOrderId, order.symbol);

                // 更新本地订单状态
                await prisma.order.updateMany({
                    where: {
                        exchange: 'binance',
                        clientOrderId: order.clientOrderId,
                    },
                    data: {
                        status: 'CANCELED',
                    },
                });

                canceledOrders++;
            } catch (error) {
                failedOrders++;
                errors.push(`Failed to cancel ${order.clientOrderId}: ${(error as Error).message}`);
            }
        }

        return {
            success: failedOrders === 0,
            canceledOrders,
            failedOrders,
            errors,
        };
    }

    /**
     * 执行 START 的 side effects
     */
    async onStart(botId: string): Promise<ReconcileResult> {
        return this.reconcile(botId);
    }

    /**
     * 执行 PAUSE 的 side effects
     * 
     * V1 行为：保留挂单不动
     */
    async onPause(_botId: string): Promise<void> {
        // V1: 不做任何事情（保留挂单）
    }

    /**
     * 执行 RESUME 的 side effects
     */
    async onResume(botId: string): Promise<ReconcileResult> {
        return this.reconcile(botId);
    }

    /**
     * 执行 STOP 的 side effects
     */
    async onStop(botId: string): Promise<CancelResult> {
        return this.cancelAllOrders(botId);
    }
}
