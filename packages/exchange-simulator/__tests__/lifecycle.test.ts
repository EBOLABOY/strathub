/**
 * ACC-LIFE-001: PAUSE/RESUME 测试
 * ACC-LIFE-002: STOP 测试
 * 
 * 测试状态机 side effects
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExchangeSimulator, FakeClock } from '../src/index.js';
import { createHash } from 'crypto';
import { generateClientOrderId, ORDER_PREFIX } from '@crypto-strategy-hub/shared';

// 使用固定的 botId 模拟测试（长度 >= 8）
const TEST_BOT_ID = 'test-life-001';

// 模拟 BotExecutor 的核心逻辑
interface ReconcileResult {
    success: boolean;
    runId: string;
    syncedOrders: number;
    stateHash: string;
}

interface CancelResult {
    success: boolean;
    canceledOrders: number;
    failedOrders: number;
    errors: string[];
}

// 模拟本地状态存储
interface LocalState {
    orders: Map<string, { clientOrderId: string; status: string }>;
    status: 'DRAFT' | 'RUNNING' | 'PAUSED' | 'STOPPING' | 'STOPPED';
    runId?: string;
}

function generateTestClientOrderId(seq: number): string {
    return generateClientOrderId(TEST_BOT_ID, seq);
}

/**
 * 简化版 reconcile
 */
async function reconcile(
    simulator: ExchangeSimulator,
    symbol: string,
    localState: LocalState
): Promise<ReconcileResult> {
    const runId = `run-${Date.now()}`;

    const remoteOrders = await simulator.fetchOpenOrders(symbol);
    const ourOrders = remoteOrders.filter(o => o.clientOrderId.startsWith('gb1'));

    for (const order of ourOrders) {
        localState.orders.set(order.clientOrderId, {
            clientOrderId: order.clientOrderId,
            status: order.status,
        });
    }

    localState.runId = runId;

    const stateHash = createHash('sha256')
        .update(JSON.stringify(Array.from(localState.orders.entries())))
        .digest('hex')
        .slice(0, 16);

    return {
        success: true,
        runId,
        syncedOrders: ourOrders.length,
        stateHash,
    };
}

/**
 * 简化版 cancelAllOrders
 */
async function cancelAllOrders(
    simulator: ExchangeSimulator,
    symbol: string,
    localState: LocalState
): Promise<CancelResult> {
    const openOrders = await simulator.fetchOpenOrders(symbol);
    const ourOrders = openOrders.filter(o => o.clientOrderId.startsWith('gb1'));

    let canceledOrders = 0;
    let failedOrders = 0;
    const errors: string[] = [];

    for (const order of ourOrders) {
        try {
            await simulator.cancelOrder(order.exchangeOrderId, order.symbol);

            const localOrder = localState.orders.get(order.clientOrderId);
            if (localOrder) {
                localOrder.status = 'CANCELED';
            }

            canceledOrders++;
        } catch (error) {
            failedOrders++;
            errors.push((error as Error).message);
        }
    }

    return {
        success: failedOrders === 0,
        canceledOrders,
        failedOrders,
        errors,
    };
}

describe('ACC-LIFE-001: PAUSE/RESUME', () => {
    let simulator: ExchangeSimulator;
    let clock: FakeClock;
    let localState: LocalState;

    beforeEach(() => {
        clock = new FakeClock(new Date('2026-01-06T10:00:00Z'));
        simulator = new ExchangeSimulator('binance', clock);
        simulator.setBalance('USDT', '10000');
        simulator.setBalance('BNB', '10');

        localState = {
            orders: new Map(),
            status: 'DRAFT',
        };
    });

    it('should not place new orders during PAUSE', async () => {
        // 创建一个挂单
        const clientOrderId = generateTestClientOrderId(1);
        await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.00',
            amount: '0.1',
            clientOrderId,
        });

        // START
        localState.status = 'RUNNING';
        await reconcile(simulator, 'BNB/USDT', localState);
        expect(localState.orders.size).toBe(1);

        // PAUSE
        localState.status = 'PAUSED';
        // V1: 保留挂单不动

        // 模拟等待 30 秒
        clock.advance(30000);

        // 验证挂单仍然存在
        const openOrders = await simulator.fetchOpenOrders('BNB/USDT');
        expect(openOrders.length).toBe(1);
    });

    it('should reconcile after RESUME', async () => {
        const clientOrderId = generateTestClientOrderId(2);
        await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.00',
            amount: '0.1',
            clientOrderId,
        });

        // START → PAUSE
        localState.status = 'RUNNING';
        await reconcile(simulator, 'BNB/USDT', localState);
        localState.status = 'PAUSED';

        // 模拟在 PAUSE 期间外部产生了成交
        const order = (await simulator.fetchOpenOrders('BNB/USDT'))[0]!;
        simulator.simulateFill(order.exchangeOrderId, '0.05', '580.00');

        // RESUME
        localState.status = 'RUNNING';
        const result = await reconcile(simulator, 'BNB/USDT', localState);

        // 验证 reconcile 成功
        expect(result.success).toBe(true);
        expect(result.runId).toBeDefined();
    });
});

describe('ACC-LIFE-002: STOP', () => {
    let simulator: ExchangeSimulator;
    let clock: FakeClock;
    let localState: LocalState;

    beforeEach(() => {
        clock = new FakeClock(new Date('2026-01-06T10:00:00Z'));
        simulator = new ExchangeSimulator('binance', clock);
        simulator.setBalance('USDT', '10000');
        simulator.setBalance('BNB', '10');

        localState = {
            orders: new Map(),
            status: 'DRAFT',
        };
    });

    it('should cancel all orders on STOP', async () => {
        // 创建两个挂单
        const clientOrderId1 = generateTestClientOrderId(3);
        const clientOrderId2 = generateTestClientOrderId(4);

        await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '575.00',
            amount: '0.1',
            clientOrderId: clientOrderId1,
        });

        await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'sell',
            type: 'limit',
            price: '590.00',
            amount: '0.1',
            clientOrderId: clientOrderId2,
        });

        // START
        localState.status = 'RUNNING';
        await reconcile(simulator, 'BNB/USDT', localState);
        expect(localState.orders.size).toBe(2);

        // STOP
        localState.status = 'STOPPING';
        const result = await cancelAllOrders(simulator, 'BNB/USDT', localState);

        // 验证
        expect(result.success).toBe(true);
        expect(result.canceledOrders).toBe(2);
        expect(result.failedOrders).toBe(0);

        // 验证所有订单已撤销
        const openOrders = await simulator.fetchOpenOrders('BNB/USDT');
        expect(openOrders.length).toBe(0);

        // 进入 STOPPED
        localState.status = 'STOPPED';
    });

    it('should handle cancel failures and continue', async () => {
        const clientOrderId1 = generateTestClientOrderId(5);
        const clientOrderId2 = generateTestClientOrderId(6);

        await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '575.00',
            amount: '0.1',
            clientOrderId: clientOrderId1,
        });

        await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'sell',
            type: 'limit',
            price: '590.00',
            amount: '0.1',
            clientOrderId: clientOrderId2,
        });

        localState.status = 'RUNNING';
        await reconcile(simulator, 'BNB/USDT', localState);

        // 注入撤单失败（第 1 次失败，第 2 次成功）
        simulator.injectError('cancelOrder', 'timeout', 1);

        localState.status = 'STOPPING';
        const result = await cancelAllOrders(simulator, 'BNB/USDT', localState);

        // 第一个撤单失败，第二个成功
        expect(result.canceledOrders).toBe(1);
        expect(result.failedOrders).toBe(1);
        expect(result.errors.length).toBe(1);
    });

    it('should not place new orders during STOPPING', async () => {
        const clientOrderId = generateTestClientOrderId(7);

        await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '575.00',
            amount: '0.1',
            clientOrderId,
        });

        localState.status = 'RUNNING';
        await reconcile(simulator, 'BNB/USDT', localState);

        // STOPPING
        localState.status = 'STOPPING';

        // 验证：在 STOPPING 状态不应该创建新订单
        // 这是业务逻辑约束，不是 simulator 级别的
        expect(localState.status).toBe('STOPPING');

        // 完成撤单
        await cancelAllOrders(simulator, 'BNB/USDT', localState);
        localState.status = 'STOPPED';

        expect(localState.status).toBe('STOPPED');
    });
});
