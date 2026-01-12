/**
 * ACC-CORE-001: 重启恢复（reconcile 不产生重复挂单）
 * 
 * 验收场景：
 * - 模拟已有 openOrders + 部分成交 trades
 * - 启动 → reconcile → 进入 RUNNING → 再次重启 → reconcile
 * - 本地状态与远端一致；不产生重复挂单；stateHash 稳定
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExchangeSimulator, FakeClock } from '../src/index.js';
import { createHash } from 'crypto';

interface LocalOrder {
    clientOrderId: string;
    exchangeOrderId?: string;
    status: string;
    filledAmount: string;
    avgFillPrice?: string;
}

interface LocalState {
    orders: Map<string, LocalOrder>;
    trades: Set<string>; // tradeId set for idempotency
}

/** 简化的 reconcile 实现 */
async function reconcile(
    simulator: ExchangeSimulator,
    symbol: string,
    localState: LocalState
): Promise<LocalState> {
    // Step 3: 拉取远端
    const remoteOrders = await simulator.fetchOpenOrders(symbol);
    const remoteTrades = await simulator.fetchMyTrades(symbol);

    // Step 4: 识别"我方订单"（gb1 前缀）
    const ourOrders = remoteOrders.filter(o => o.clientOrderId.startsWith('gb1'));

    // Step 5: 对齐订单
    for (const remoteOrder of ourOrders) {
        const localOrder = localState.orders.get(remoteOrder.clientOrderId);

        if (localOrder) {
            // 更新本地状态
            localOrder.exchangeOrderId = remoteOrder.exchangeOrderId;
            localOrder.status = remoteOrder.status;
            localOrder.filledAmount = remoteOrder.filledAmount;
            localOrder.avgFillPrice = remoteOrder.avgFillPrice;
        } else {
            // 本地没有，从远端恢复
            localState.orders.set(remoteOrder.clientOrderId, {
                clientOrderId: remoteOrder.clientOrderId,
                exchangeOrderId: remoteOrder.exchangeOrderId,
                status: remoteOrder.status,
                filledAmount: remoteOrder.filledAmount,
                avgFillPrice: remoteOrder.avgFillPrice,
            });
        }
    }

    // Step 6: 对齐成交（幂等）
    for (const trade of remoteTrades) {
        if (!localState.trades.has(trade.tradeId)) {
            localState.trades.add(trade.tradeId);
            // 注意：不需要在这里更新订单的 filledAmount
            // 因为订单的 filledAmount 已经在 Step 5 从远端订单同步了
            // 这里只需要记录 tradeId 用于幂等性检查
        }
    }

    return localState;
}

/** 计算状态哈希 */
function computeStateHash(state: LocalState): string {
    const ordersArray = Array.from(state.orders.entries())
        .sort(([a], [b]) => a.localeCompare(b));
    const tradesArray = Array.from(state.trades).sort();

    const content = JSON.stringify({ orders: ordersArray, trades: tradesArray });
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

describe('ACC-CORE-001: 重启恢复', () => {
    let simulator: ExchangeSimulator;
    let clock: FakeClock;

    beforeEach(() => {
        clock = new FakeClock(new Date('2026-01-06T10:00:00Z'));
        simulator = new ExchangeSimulator('binance', clock);
        simulator.setBalance('USDT', '10000');
        simulator.setBalance('BNB', '10');
    });

    it('should sync local state with remote after reconcile', async () => {
        // 创建两个订单
        const order1 = await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.00',
            amount: '0.5',
            clientOrderId: 'gb1order001aaaaaaaaaaaaaaaaaa',
        });

        const order2 = await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'sell',
            type: 'limit',
            price: '590.00',
            amount: '0.3',
            clientOrderId: 'gb1order002aaaaaaaaaaaaaaaaaa',
        });

        // 模拟部分成交
        simulator.simulateFill(order1.exchangeOrderId, '0.2', '580.00');

        // 模拟"重启"：创建新的空本地状态
        const localState: LocalState = {
            orders: new Map(),
            trades: new Set(),
        };

        // 执行 reconcile
        await reconcile(simulator, 'BNB/USDT', localState);

        // Assertions
        expect(localState.orders.size).toBe(2);
        expect(localState.trades.size).toBe(1);

        const localOrder1 = localState.orders.get('gb1order001aaaaaaaaaaaaaaaaaa');
        expect(localOrder1).toBeDefined();
        expect(localOrder1!.status).toBe('PARTIALLY_FILLED');
        expect(localOrder1!.filledAmount).toBe('0.20000000');
    });

    it('should not produce duplicate orders after second reconcile', async () => {
        // 创建订单
        await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.00',
            amount: '1.0',
            clientOrderId: 'gb1order003aaaaaaaaaaaaaaaaaa',
        });

        const localState: LocalState = {
            orders: new Map(),
            trades: new Set(),
        };

        // 第一次 reconcile
        await reconcile(simulator, 'BNB/USDT', localState);
        const orderCountAfterFirst = localState.orders.size;
        const hash1 = computeStateHash(localState);

        // 第二次 reconcile（模拟第二次重启）
        await reconcile(simulator, 'BNB/USDT', localState);
        const orderCountAfterSecond = localState.orders.size;
        const hash2 = computeStateHash(localState);

        // Assertions
        expect(orderCountAfterSecond).toBe(orderCountAfterFirst);
        expect(simulator.getOrderCount()).toBe(1); // 远端也只有 1 个订单
    });

    it('should have stable stateHash when no new events', async () => {
        await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.00',
            amount: '0.5',
            clientOrderId: 'gb1order004aaaaaaaaaaaaaaaaaa',
        });

        const localState: LocalState = {
            orders: new Map(),
            trades: new Set(),
        };

        // 多次 reconcile
        await reconcile(simulator, 'BNB/USDT', localState);
        const hash1 = computeStateHash(localState);

        clock.advance(1000);
        await reconcile(simulator, 'BNB/USDT', localState);
        const hash2 = computeStateHash(localState);

        clock.advance(1000);
        await reconcile(simulator, 'BNB/USDT', localState);
        const hash3 = computeStateHash(localState);

        // stateHash 应该稳定
        expect(hash1).toBe(hash2);
        expect(hash2).toBe(hash3);
    });

    it('should handle partial fills correctly after reconcile', async () => {
        const order = await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.00',
            amount: '1.0',
            clientOrderId: 'gb1order005aaaaaaaaaaaaaaaaaa',
        });

        // 模拟多笔成交（乱序）
        simulator.simulateFill(order.exchangeOrderId, '0.3', '580.00');
        simulator.simulateFill(order.exchangeOrderId, '0.4', '580.00');

        const localState: LocalState = {
            orders: new Map(),
            trades: new Set(),
        };

        await reconcile(simulator, 'BNB/USDT', localState);

        // 应该有 2 条 trade（幂等，不重复）
        expect(localState.trades.size).toBe(2);

        // 再次 reconcile（模拟重复推送）
        await reconcile(simulator, 'BNB/USDT', localState);

        // trade 数量不变
        expect(localState.trades.size).toBe(2);
    });

    it('should only sync orders with gb1 prefix', async () => {
        // 创建"我方订单"
        await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.00',
            amount: '0.5',
            clientOrderId: 'gb1myorder001aaaaaaaaaaaaaaaaa',
        });

        // 创建"非我方订单"（模拟用户手动单）
        await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'sell',
            type: 'limit',
            price: '600.00',
            amount: '0.5',
            clientOrderId: 'user-manual-order-001',
        });

        const localState: LocalState = {
            orders: new Map(),
            trades: new Set(),
        };

        await reconcile(simulator, 'BNB/USDT', localState);

        // 只同步 gb1 前缀的订单
        expect(localState.orders.size).toBe(1);
        expect(localState.orders.has('gb1myorder001aaaaaaaaaaaaaaaaa')).toBe(true);
        expect(localState.orders.has('user-manual-order-001')).toBe(false);
    });
});
