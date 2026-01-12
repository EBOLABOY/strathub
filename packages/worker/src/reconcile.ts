/**
 * Reconcile Loop
 * 
 * fetchOpenOrders + fetchMyTrades → upsert Order → 幂等落 Trade → BotSnapshot
 * 
 * 规则：
 * - 任一 fetch 失败 → 503，不改 bot 状态
 * - Order 状态只能单调递进（NEW → PARTIALLY_FILLED → FILLED/CANCELED）
 * - Trade 幂等落库（by tradeId）
 * - stateHash 稳定（不含 timestamp，仅订单/成交 ID）
 */

import { prisma, Prisma } from '@crypto-strategy-hub/database';
import type { ReconcileExecutor, TradeRecord, FullOrderRecord } from './simulator-executor.js';
import { ORDER_PREFIX } from '@crypto-strategy-hub/shared';
import { computeStateHash } from './utils.js';
import { Decimal } from 'decimal.js';

// ============================================================================
// Types
// ============================================================================

export interface ReconcileResult {
    success: boolean;
    ordersUpserted: number;
    tradesInserted: number;
    snapshotCreated: boolean;
    stateHash?: string;
    error?: string;
}

export interface ReconcileDeps {
    executor: ReconcileExecutor;
}

// ============================================================================
// Reconcile 实现
// ============================================================================

export async function reconcileBot(
    botId: string,
    deps: ReconcileDeps
): Promise<ReconcileResult> {
    // 1. 获取 bot
    const bot = await prisma.bot.findUnique({
        where: { id: botId },
        select: {
            id: true,
            symbol: true,
            status: true,
            runId: true,
            exchangeAccountId: true,
        },
    });

    if (!bot) {
        return { success: false, ordersUpserted: 0, tradesInserted: 0, snapshotCreated: false, error: 'Bot not found' };
    }

    // 只 reconcile RUNNING/WAITING_TRIGGER/STOPPING
    if (!['RUNNING', 'WAITING_TRIGGER', 'STOPPING'].includes(bot.status)) {
        return { success: true, ordersUpserted: 0, tradesInserted: 0, snapshotCreated: false };
    }

    // 2. Fetch open orders (已过滤 gb1 前缀)
    let openOrders: FullOrderRecord[];
    try {
        openOrders = await deps.executor.fetchOpenOrdersFull(bot.symbol);
    } catch (error) {
        console.error(`[Reconcile] Bot ${botId}: failed to fetch open orders:`, error);
        return { success: false, ordersUpserted: 0, tradesInserted: 0, snapshotCreated: false, error: '503 EXCHANGE_UNAVAILABLE' };
    }

    // 3. Fetch trades (已过滤 gb1 前缀)
    let trades: TradeRecord[];
    try {
        trades = await deps.executor.fetchMyTrades(bot.symbol);
    } catch (error) {
        console.error(`[Reconcile] Bot ${botId}: failed to fetch trades:`, error);
        return { success: false, ordersUpserted: 0, tradesInserted: 0, snapshotCreated: false, error: '503 EXCHANGE_UNAVAILABLE' };
    }

    console.log(`[Reconcile] Bot ${botId}: ${openOrders.length} open orders, ${trades.length} trades`);

    // 4. Upsert orders（使用真实字段）
    let ordersUpserted = 0;
    const openOrderIds = new Set(openOrders.map((o) => o.id));

    for (const order of openOrders) {
        try {
            await prisma.order.upsert({
                where: {
                    exchange_clientOrderId: {
                        exchange: 'binance',
                        clientOrderId: order.clientOrderId,
                    },
                },
                create: {
                    botId,
                    exchange: 'binance',
                    symbol: order.symbol,
                    clientOrderId: order.clientOrderId,
                    exchangeOrderId: order.id,
                    side: order.side,
                    type: order.type,
                    price: order.price,
                    amount: order.amount,
                    filledAmount: order.filledAmount,
                    status: order.status,
                },
                update: {
                    exchangeOrderId: order.id,
                    filledAmount: order.filledAmount,
                    // 状态单调：不降级
                },
            });
            ordersUpserted++;
        } catch (error) {
            console.error(`[Reconcile] Failed to upsert order ${order.id}:`, error);
        }
    }

    // 4.5 准备 Trade 归属映射
    // 由于 Binance myTrades 经常缺少 clientOrderId，我们需要通过 orderId 匹配 DB 中的 Active Orders
    const activeDbOrders = await prisma.order.findMany({
        where: {
            botId,
            exchangeOrderId: { not: null }
        },
        select: { clientOrderId: true, exchangeOrderId: true }
    });
    const orderIdMap = new Map<string, string>(); // exchangeOrderId -> clientOrderId
    for (const o of activeDbOrders) {
        if (o.exchangeOrderId && o.clientOrderId) {
            orderIdMap.set(o.exchangeOrderId, o.clientOrderId);
        }
    }

    // 过滤并补全 trades
    // 策略：DB 优先。如果 orderId 命中 DB，强制使用 DB 的 clientOrderId
    const originalTrades = trades;
    trades = [];
    for (const t of originalTrades) {
        // DB 优先：如果 orderId 在 DB 命中，强制使用 DB 的 clientOrderId
        const dbClientOrderId = t.orderId ? orderIdMap.get(t.orderId) : undefined;
        const cid = dbClientOrderId || t.clientOrderId;

        // 只有归属于本 bot 的 trade 才处理
        // 唯一判定：clientOrderId 必须以 ORDER_PREFIX 开头
        if (cid?.startsWith(ORDER_PREFIX)) {
            trades.push({
                ...t,
                clientOrderId: cid
            });
        }
    }

    // 5. 幂等落 trades
    let tradesInserted = 0;
    for (const trade of trades) {
        try {
            await prisma.trade.upsert({
                where: {
                    exchange_tradeId: {
                        exchange: 'binance',
                        tradeId: trade.id,
                    },
                },
                create: {
                    botId,
                    tradeId: trade.id,
                    clientOrderId: trade.clientOrderId,
                    exchange: 'binance',
                    symbol: trade.symbol,
                    side: trade.side,
                    price: trade.price,
                    amount: trade.amount,
                    fee: trade.fee,
                    feeCurrency: trade.feeCurrency,
                    timestamp: new Date(trade.timestamp),
                },
                update: {},
            });
            tradesInserted++;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                // 已存在，幂等成功
            } else {
                console.error(`[Reconcile] Failed to insert trade ${trade.id}:`, error);
            }
        }
    }

    // 6. 汇总 trades → 更新订单 filledAmount/avgFillPrice/status
    // 按 clientOrderId 分组 trades
    const tradesByClientOrderId = new Map<string, typeof trades>();
    for (const trade of trades) {
        if (!trade.clientOrderId) continue;
        const existing = tradesByClientOrderId.get(trade.clientOrderId) || [];
        existing.push(trade);
        tradesByClientOrderId.set(trade.clientOrderId, existing);
    }

    for (const [clientOrderId, orderTrades] of tradesByClientOrderId) {
        // 使用 Decimal 计算 filledAmount 和 avgFillPrice (加权平均)
        let totalFilled = new Decimal(0);
        let totalNotional = new Decimal(0);
        for (const t of orderTrades) {
            const amount = new Decimal(t.amount);
            const price = new Decimal(t.price);
            totalFilled = totalFilled.plus(amount);
            totalNotional = totalNotional.plus(amount.times(price));
        }
        const avgFillPrice = totalFilled.gt(0) ? totalNotional.div(totalFilled).toFixed(8) : null;
        const filledAmount = totalFilled.toFixed(8);

        // 查询订单
        const order = await prisma.order.findFirst({
            where: { botId, clientOrderId },
        });
        if (!order) continue;

        // 判断是否已全部成交（不在 openOrders 中 + filledAmount >= amount）
        const orderAmount = new Decimal(order.amount);
        const isFullyFilled = totalFilled.gte(orderAmount) && !openOrderIds.has(order.exchangeOrderId || '');

        // 状态单调：只能升级，不能降级
        let newStatus = order.status;
        if (isFullyFilled && order.status !== 'FILLED' && order.status !== 'CANCELED') {
            newStatus = 'FILLED';
        } else if (totalFilled.gt(0) && order.status === 'NEW') {
            newStatus = 'PARTIALLY_FILLED';
        }

        // 更新订单
        await prisma.order.update({
            where: { id: order.id },
            data: {
                filledAmount,
                avgFillPrice,
                status: newStatus,
            },
        });
    }

    // 7. 创建 BotSnapshot（使用纯函数计算 stateHash）
    try {
        const { stateJson, stateHash } = computeStateHash(
            Array.from(openOrderIds),
            trades.map((t) => t.id)
        );

        // 检查最近的 snapshot，如果 hash 相同则不创建
        const lastSnapshot = await prisma.botSnapshot.findFirst({
            where: { botId },
            orderBy: { createdAt: 'desc' },
        });

        if (lastSnapshot?.stateHash === stateHash) {
            console.log(`[Reconcile] Bot ${botId}: state unchanged, skip snapshot`);
            return {
                success: true,
                ordersUpserted,
                tradesInserted,
                snapshotCreated: false,
                stateHash,
            };
        }

        await prisma.botSnapshot.create({
            data: {
                botId,
                runId: bot.runId || `reconcile-${Date.now()}`,
                reconciledAt: new Date(),
                stateJson,
                stateHash,
            },
        });

        console.log(`[Reconcile] Bot ${botId}: snapshot created, hash=${stateHash}`);
        return {
            success: true,
            ordersUpserted,
            tradesInserted,
            snapshotCreated: true,
            stateHash,
        };
    } catch (error) {
        console.error(`[Reconcile] Failed to create snapshot:`, error);
        return {
            success: true,
            ordersUpserted,
            tradesInserted,
            snapshotCreated: false,
            error: 'Snapshot creation failed',
        };
    }
}
