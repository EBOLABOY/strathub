/**
 * Reconcile Loop 验收测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@crypto-strategy-hub/database';
import { ExchangeSimulator } from '@crypto-strategy-hub/exchange-simulator';
import { generateClientOrderId } from '@crypto-strategy-hub/shared';
import { createSimulatorExecutor } from '../src/simulator-executor.js';
import { reconcileBot } from '../src/reconcile.js';

// ============================================================================
// Test Fixtures
// ============================================================================

let testUserId: string;
let testExchangeAccountId: string;

const dummyConfig = JSON.stringify({
    trigger: { gridType: 'percent', basePriceType: 'manual', basePrice: '600', riseSell: '1', fallBuy: '1' },
    order: { orderType: 'limit' },
    sizing: { amountMode: 'amount', gridSymmetric: true, symmetric: { orderQuantity: '100' } },
});

// ============================================================================
// Setup/Cleanup
// ============================================================================

beforeAll(async () => {
    const user = await prisma.user.create({
        data: {
            email: `test-reconcile-${Date.now()}@test.com`,
            passwordHash: 'test-hash',
        },
    });
    testUserId = user.id;

    const account = await prisma.exchangeAccount.create({
        data: {
            userId: testUserId,
            exchange: 'binance',
            name: 'test-reconcile-account',
            encryptedCredentials: '{}',
        },
    });
    testExchangeAccountId = account.id;
});

afterAll(async () => {
    await prisma.botSnapshot.deleteMany({ where: { bot: { userId: testUserId } } });
    await prisma.trade.deleteMany({ where: { bot: { userId: testUserId } } });
    await prisma.order.deleteMany({ where: { bot: { userId: testUserId } } });
    await prisma.bot.deleteMany({ where: { userId: testUserId } });
    await prisma.exchangeAccount.deleteMany({ where: { userId: testUserId } });
    await prisma.user.delete({ where: { id: testUserId } });
});

beforeEach(async () => {
    await prisma.botSnapshot.deleteMany({ where: { bot: { userId: testUserId } } });
    await prisma.trade.deleteMany({ where: { bot: { userId: testUserId } } });
    await prisma.order.deleteMany({ where: { bot: { userId: testUserId } } });
    await prisma.bot.deleteMany({ where: { userId: testUserId } });
});

// ============================================================================
// Tests
// ============================================================================

describe('Reconcile Loop 验收测试', () => {
    it('should sync orders and trades and create snapshot', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'REC-BNB/USDT',
                configJson: dummyConfig,
                status: 'RUNNING',
                statusVersion: 5,
            },
        });

        // 创建 simulator 并模拟订单和成交
        const simulator = new ExchangeSimulator();
        simulator.setTicker('REC-BNB/USDT', '600');
        simulator.setBalance('USDT', '10000');
        simulator.setBalance('BNB', '10');

        const clientOrderId = generateClientOrderId(bot.id, 1);
        const order = await simulator.createOrder({
            symbol: 'REC-BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580',
            amount: '1',
            clientOrderId,
        });

        // 模拟成交
        simulator.simulateFill(order.exchangeOrderId, '0.5', '580');

        const executor = createSimulatorExecutor(simulator);
        const result = await reconcileBot(bot.id, { executor });

        expect(result.success).toBe(true);
        expect(result.ordersUpserted).toBeGreaterThanOrEqual(1);
        expect(result.tradesInserted).toBeGreaterThanOrEqual(1);
        expect(result.snapshotCreated).toBe(true);

        // 验证 snapshot 已创建
        const snapshots = await prisma.botSnapshot.findMany({ where: { botId: bot.id } });
        expect(snapshots.length).toBe(1);
        expect(snapshots[0].stateHash).toBeDefined();
    });

    it('should not change status when fetch fails (503)', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'REC-ETH/USDT',
                configJson: dummyConfig,
                status: 'RUNNING',
                statusVersion: 5,
            },
        });

        // 创建失败的 executor
        const failingExecutor = {
            async fetchOpenOrders() {
                throw new Error('Network timeout');
            },
            async fetchOpenOrdersFull() {
                throw new Error('Network timeout');
            },
            async cancelOrder() {
                throw new Error('Network timeout');
            },
            async fetchMyTrades() {
                throw new Error('Network timeout');
            },
        };

        const result = await reconcileBot(bot.id, { executor: failingExecutor });

        expect(result.success).toBe(false);
        expect(result.error).toContain('503');

        // 验证没有创建 snapshot
        const snapshots = await prisma.botSnapshot.findMany({ where: { botId: bot.id } });
        expect(snapshots.length).toBe(0);
    });

    it('should skip non-active bots', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'REC-SOL/USDT',
                configJson: dummyConfig,
                status: 'STOPPED',
                statusVersion: 5,
            },
        });

        const simulator = new ExchangeSimulator();
        const executor = createSimulatorExecutor(simulator);

        const result = await reconcileBot(bot.id, { executor });

        expect(result.success).toBe(true);
        expect(result.ordersUpserted).toBe(0);
        expect(result.snapshotCreated).toBe(false);
    });

    it('should be idempotent (no duplicate trades)', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'REC-DOGE/USDT',
                configJson: dummyConfig,
                status: 'RUNNING',
                statusVersion: 5,
            },
        });

        const simulator = new ExchangeSimulator();
        simulator.setTicker('REC-DOGE/USDT', '0.1');
        simulator.setBalance('USDT', '1000');

        const clientOrderId = generateClientOrderId(bot.id, 1);
        const order = await simulator.createOrder({
            symbol: 'REC-DOGE/USDT',
            side: 'buy',
            type: 'limit',
            price: '0.09',
            amount: '100',
            clientOrderId,
        });
        simulator.simulateFill(order.exchangeOrderId, '50', '0.09');

        const executor = createSimulatorExecutor(simulator);

        // 第一次 reconcile
        const result1 = await reconcileBot(bot.id, { executor });
        expect(result1.success).toBe(true);

        // 第二次 reconcile（幂等）
        const result2 = await reconcileBot(bot.id, { executor });
        expect(result2.success).toBe(true);

        // 验证 trade 只有 1 条
        const trades = await prisma.trade.findMany({ where: { botId: bot.id } });
        expect(trades.length).toBe(1);
    });

    // stateHash 稳定性由纯函数单测保证，这里验证"hash 相同不写 snapshot"
    it('should skip snapshot when state unchanged', async () => {
        // 使用动态 symbol 避免并发冲突
        const testSymbol = `STABLE-${Date.now()}/USDT`;

        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: testSymbol,
                configJson: dummyConfig,
                status: 'RUNNING',
                statusVersion: 5,
            },
        });

        const simulator = new ExchangeSimulator();
        simulator.setTicker(testSymbol, '30');
        simulator.setBalance('USDT', '5000');

        const clientOrderId = generateClientOrderId(bot.id, 1);
        const order = await simulator.createOrder({
            symbol: testSymbol,
            side: 'buy',
            type: 'limit',
            price: '28',
            amount: '10',
            clientOrderId,
        });

        const executor = createSimulatorExecutor(simulator);

        // 第一次 reconcile
        const result1 = await reconcileBot(bot.id, { executor });
        expect(result1.success).toBe(true);
        expect(result1.snapshotCreated).toBe(true);
        const hash1 = result1.stateHash;

        // 第二次 reconcile（状态无变化）
        const result2 = await reconcileBot(bot.id, { executor });
        expect(result2.success).toBe(true);
        expect(result2.snapshotCreated).toBe(false); // 不创建新 snapshot
        expect(result2.stateHash).toBe(hash1); // hash 稳定

        // 验证只有 1 个 snapshot
        const snapshots = await prisma.botSnapshot.findMany({ where: { botId: bot.id } });
        expect(snapshots.length).toBe(1);
    });

    it('should not import non-gb1 orders/trades', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'REC-LINK/USDT',
                configJson: dummyConfig,
                status: 'RUNNING',
                statusVersion: 5,
            },
        });

        const simulator = new ExchangeSimulator();
        simulator.setTicker('REC-LINK/USDT', '15');
        simulator.setBalance('USDT', '3000');
        simulator.setBalance('REC-LINK', '100'); // 卖单需要 REC-LINK 余额

        // 创建非 gb1 前缀的订单（模拟用户手工挂单）
        await simulator.createOrder({
            symbol: 'REC-LINK/USDT',
            side: 'buy',
            type: 'limit',
            price: '14',
            amount: '20',
            clientOrderId: 'user-manual-001', // 非 gb1 前缀
        });

        // 创建 gb1 前缀的订单
        const clientOrderId = generateClientOrderId(bot.id, 1);
        await simulator.createOrder({
            symbol: 'REC-LINK/USDT',
            side: 'sell',
            type: 'limit',
            price: '16',
            amount: '10',
            clientOrderId,
        });

        const executor = createSimulatorExecutor(simulator);
        const result = await reconcileBot(bot.id, { executor });

        expect(result.success).toBe(true);
        expect(result.ordersUpserted).toBe(1); // 只同步 gb1 订单

        // 验证只导入了 gb1 订单
        const orders = await prisma.order.findMany({ where: { botId: bot.id } });
        expect(orders.length).toBe(1);
        expect(orders[0].clientOrderId).toBe(clientOrderId);
    });

    /**
     * 验收：reconcile 汇总 trades → 推进订单到 FILLED + avgFillPrice
     * 
     * 这是闭环关键：只有 reconcile 能把订单推进到 FILLED，trigger-order 才能触发下一腿
     */
    it('should advance order to FILLED when all trades received', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'REC-FILL/USDT',
                configJson: dummyConfig,
                status: 'RUNNING',
                statusVersion: 5,
            },
        });

        // 创建一个待成交的订单
        const clientOrderId = generateClientOrderId(bot.id, 1);
        await prisma.order.create({
            data: {
                botId: bot.id,
                exchange: 'binance',
                symbol: 'REC-FILL/USDT',
                clientOrderId,
                exchangeOrderId: 'sim-order-fill-001',
                side: 'buy',
                type: 'limit',
                price: '100',
                amount: '10',
                filledAmount: '0',
                status: 'NEW',
                submittedAt: new Date(),
            },
        });

        const simulator = new ExchangeSimulator();
        simulator.setTicker('REC-FILL/USDT', '100');
        simulator.setBalance('USDT', '10000');
        simulator.setBalance('REC-FILL', '100');

        // 创建订单并模拟成交
        const order = await simulator.createOrder({
            symbol: 'REC-FILL/USDT',
            side: 'buy',
            type: 'limit',
            price: '100',
            amount: '10',
            clientOrderId,
        });
        // 模拟全部成交
        simulator.simulateFill(order.exchangeOrderId, '10', '100');

        const executor = createSimulatorExecutor(simulator);
        await reconcileBot(bot.id, { executor });

        // 验证订单被推进到 FILLED
        const updatedOrder = await prisma.order.findFirst({
            where: { botId: bot.id, clientOrderId },
        });
        expect(updatedOrder!.status).toBe('FILLED');
        expect(updatedOrder!.filledAmount).toBe('10.00000000');
        expect(updatedOrder!.avgFillPrice).toBe('100.00000000');
    });

    it('should match trade by orderId when clientOrderId is missing', async () => {
        // 场景：Binance trade 缺少 clientOrderId，但 orderId 能命中 DB
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'ORDID-TEST/USDT',
                configJson: dummyConfig,
                status: 'RUNNING',
            },
        });

        // 1. 先在 DB 中创建订单（模拟之前已下单）
        const clientOrderId = generateClientOrderId(bot.id, 1);
        const dbOrder = await prisma.order.create({
            data: {
                botId: bot.id,
                exchange: 'binance',
                symbol: 'ORDID-TEST/USDT',
                clientOrderId,
                exchangeOrderId: 'exc-12345',
                side: 'buy',
                type: 'limit',
                price: '100',
                amount: '10',
                status: 'NEW',
            },
        });

        // 2. Mock executor: trade 没有 clientOrderId，只有 orderId
        const mockExecutor = {
            fetchOpenOrdersFull: async () => [],
            fetchMyTrades: async () => [{
                id: 'trade-001',
                orderId: 'exc-12345', // 命中 DB
                clientOrderId: undefined, // 缺失！
                symbol: 'ORDID-TEST/USDT',
                side: 'buy',
                price: '100',
                amount: '10',
                fee: '0.01',
                feeCurrency: 'USDT',
                timestamp: new Date().toISOString(),
            }],
        };

        const result = await reconcileBot(bot.id, { executor: mockExecutor as any });
        expect(result.success).toBe(true);

        // 验证订单被推进到 FILLED
        const updatedOrder = await prisma.order.findUnique({ where: { id: dbOrder.id } });
        expect(updatedOrder!.status).toBe('FILLED');
        expect(updatedOrder!.filledAmount).toBe('10.00000000');
    });

    it('should force DB clientOrderId when trade has wrong prefix but orderId matches', async () => {
        // 场景：trade 有错误的 clientOrderId（非 gb1），但 orderId 命中 DB，应强制使用 DB 的
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'FORCE-CID/USDT',
                configJson: dummyConfig,
                status: 'RUNNING',
            },
        });

        // 1. DB 中的订单
        const clientOrderId = generateClientOrderId(bot.id, 1);
        const dbOrder = await prisma.order.create({
            data: {
                botId: bot.id,
                exchange: 'binance',
                symbol: 'FORCE-CID/USDT',
                clientOrderId,
                exchangeOrderId: 'exc-force-001',
                side: 'buy',
                type: 'limit',
                price: '200',
                amount: '5',
                status: 'NEW',
            },
        });

        // 2. Mock executor: trade 有错误 clientOrderId (other-prefix)，但 orderId 正确
        const mockExecutor = {
            fetchOpenOrdersFull: async () => [],
            fetchMyTrades: async () => [{
                id: 'trade-force-001',
                orderId: 'exc-force-001', // 命中 DB
                clientOrderId: 'other-prefix-123', // 错误！但 DB 优先
                symbol: 'FORCE-CID/USDT',
                side: 'buy',
                price: '200',
                amount: '5',
                fee: '0.02',
                feeCurrency: 'USDT',
                timestamp: new Date().toISOString(),
            }],
        };

        const result = await reconcileBot(bot.id, { executor: mockExecutor as any });
        expect(result.success).toBe(true);

        // 验证订单被推进到 FILLED（通过 DB 的 gb1 clientOrderId 关联）
        const updatedOrder = await prisma.order.findUnique({ where: { id: dbOrder.id } });
        expect(updatedOrder!.status).toBe('FILLED');

        // 验证 Trade 落库时使用了 DB 的 clientOrderId
        const trade = await prisma.trade.findFirst({ where: { botId: bot.id, tradeId: 'trade-force-001' } });
        expect(trade!.clientOrderId).toBe(clientOrderId);
    });
});
