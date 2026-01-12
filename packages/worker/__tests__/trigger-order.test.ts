/**
 * Trigger/Order Loop 验收测试
 * 
 * 口径决策：
 * - clientOrderId: 先落库意图（Order.submittedAt=null）→ 再 I/O
 * - 成交后基准价: 用上次成交均价做下一腿定价
 * 
 * 约束：
 * - 同一 bot 同时最多 1 个 open order
 * - clientOrderId 格式: gb1-{botId 前 8 位}-{intentSeq}
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { prisma } from '@crypto-strategy-hub/database';
import { ExchangeSimulator, RateLimitError } from '@crypto-strategy-hub/exchange-simulator';
import { createSimulatorExecutor } from '../src/simulator-executor.js';
import { processTriggerOrder } from '../src/trigger-order.js';
import { reconcileBot } from '../src/reconcile.js';
import { generateClientOrderId } from '@crypto-strategy-hub/shared';

// ============================================================================
// Test Fixtures
// ============================================================================

let testUserId: string;
let testExchangeAccountId: string;

/**
 * 网格配置：
 * - basePrice: 100
 * - riseSell: 5% (触发价 105)
 * - fallBuy: 5% (触发价 95)
 * - orderQuantity: 10
 */
const gridConfig = JSON.stringify({
    trigger: {
        gridType: 'percent',
        basePriceType: 'manual',
        basePrice: '100',
        riseSell: '5',
        fallBuy: '5',
    },
    order: { orderType: 'limit' },
    sizing: {
        amountMode: 'amount',
        gridSymmetric: true,
        symmetric: { orderQuantity: '10' },
    },
});

const gridConfigWithBounds = JSON.stringify({
    trigger: {
        gridType: 'percent',
        basePriceType: 'manual',
        basePrice: '100',
        riseSell: '5',
        fallBuy: '5',
        priceMin: '50',
        priceMax: '150',
    },
    order: { orderType: 'limit' },
    sizing: {
        amountMode: 'amount',
        gridSymmetric: true,
        symmetric: { orderQuantity: '10' },
    },
});

// ============================================================================
// Setup/Cleanup
// ============================================================================

beforeAll(async () => {
    const user = await prisma.user.create({
        data: {
            email: `test-trigger-${Date.now()}@test.com`,
            passwordHash: 'test-hash',
        },
    });
    testUserId = user.id;

    const account = await prisma.exchangeAccount.create({
        data: {
            userId: testUserId,
            exchange: 'binance',
            name: 'test-trigger-account',
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
// 验收测试
// ============================================================================

describe('Trigger/Order Loop 验收测试', () => {
    /**
     * 验收 1：未触发不下单、不 bump
     * 
     * 初始条件：
     * - Bot status = WAITING_TRIGGER
     * - 无 open orders
     * - ticker.last = 100（在触发线 95-105 之间）
     * 
     * 断言：
     * - executor.getCreateOrderCallCount() === 0
     * - DB 无新增 Order
     * - Bot.status 仍为 WAITING_TRIGGER
     * - Bot.statusVersion 不变
     */
    it('should NOT create order when price within trigger range', async () => {
        // Arrange
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'TRIG-TEST1/USDT',
                configJson: gridConfig,
                status: 'WAITING_TRIGGER',
                statusVersion: 5,
            },
        });

        const simulator = new ExchangeSimulator();
        simulator.setTicker('TRIG-TEST1/USDT', '100'); // 在 95-105 之间
        simulator.setBalance('USDT', '10000');
        simulator.setBalance('TRIG-TEST1', '100');

        const executor = createSimulatorExecutor(simulator);

        // Act: 模拟 processTriggerOrder(botId, executor, ticker.last='100')
        // TODO: 实现 processTriggerOrder 后替换此处
        await processTriggerOrder(bot.id, { executor, tickerPrice: '100' });

        // Assert: createOrder 从未被调用
        expect(executor.getCreateOrderCallCount()).toBe(0);

        const orders = await prisma.order.findMany({ where: { botId: bot.id } });
        expect(orders.length).toBe(0);

        const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
        expect(afterBot!.status).toBe('WAITING_TRIGGER');
        expect(afterBot!.statusVersion).toBe(5); // 不变
    });

    /**
     * 验收 2：触发只产生 1 个 intent/clientOrderId（幂等）
     * 
     * 初始条件：
     * - Bot status = WAITING_TRIGGER
     * - ticker.last = 94（<= buyTrigger 95，触发买入）
     * 
     * 断言（第一次 tick）：
     * - DB 创建 1 条 Order（submittedAt != null 表示已提交）
     * - executor.getCreateOrderCallCount() === 1
     * - Bot.status → RUNNING
     * - Bot.statusVersion bump 1 次（5 → 6）
     * - clientOrderId 格式锁死: gb1-{botId 前 8 位}-1
     * - Order.intentSeq === 1
     * 
     * 断言（第二次 tick，同样行情）：
     * - executor.getCreateOrderCallCount() === 1（不再调用）
     * - DB Order 数量仍为 1
     * - clientOrderId 不变
     * - Bot.status 仍为 RUNNING
     * - Bot.statusVersion 不再 bump（仍为 6）
     */
    it('should create exactly 1 order on trigger and be idempotent', async () => {
        // Arrange
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'TRIG-TEST2/USDT',
                configJson: gridConfig,
                status: 'WAITING_TRIGGER',
                statusVersion: 5,
            },
        });

        const simulator = new ExchangeSimulator();
        simulator.setTicker('TRIG-TEST2/USDT', '94'); // < 95 触发买入
        simulator.setBalance('USDT', '10000');
        simulator.setBalance('TRIG-TEST2', '100');

        const executor = createSimulatorExecutor(simulator);

        // 预期的 clientOrderId 格式
        const expectedClientOrderId = generateClientOrderId(bot.id, 1);

        // Act: 第一次 tick
        // TODO: 实现 processTriggerOrder 后替换此处
        await processTriggerOrder(bot.id, { executor, tickerPrice: '94' });

        // Assert: 第一次 tick - createOrder 调用 1 次
        expect(executor.getCreateOrderCallCount()).toBe(1);

        const orders1 = await prisma.order.findMany({ where: { botId: bot.id } });
        expect(orders1.length).toBe(1);
        expect(orders1[0].side).toBe('buy');
        // 锁死 clientOrderId 格式
        expect(orders1[0].clientOrderId).toBe(expectedClientOrderId);
        expect(orders1[0].intentSeq).toBe(1);

        const afterBot1 = await prisma.bot.findUnique({ where: { id: bot.id } });
        expect(afterBot1!.status).toBe('RUNNING');
        expect(afterBot1!.statusVersion).toBe(6); // bump 1 次

        // Act: 第二次 tick（同样行情）
        await processTriggerOrder(bot.id, { executor, tickerPrice: '94' });

        // Assert: 幂等 - createOrder 不再调用
        expect(executor.getCreateOrderCallCount()).toBe(1); // 仍为 1

        const orders2 = await prisma.order.findMany({ where: { botId: bot.id } });
        expect(orders2.length).toBe(1);
        expect(orders2[0].clientOrderId).toBe(expectedClientOrderId); // 不变

        const afterBot2 = await prisma.bot.findUnique({ where: { id: bot.id } });
        expect(afterBot2!.status).toBe('RUNNING'); // 仍为 RUNNING
        expect(afterBot2!.statusVersion).toBe(6); // 不再 bump
    });

    it('should NOT submit outbox when bot status is STOPPING/PAUSED/STOPPED/ERROR', async () => {
        const statuses = ['STOPPING', 'PAUSED', 'STOPPED', 'ERROR'] as const;

        for (const status of statuses) {
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: `TRIG-OUTBOX-${status}/USDT`,
                    configJson: gridConfig,
                    status,
                    statusVersion: 5,
                },
            });

            const outboxOrder = await prisma.order.create({
                data: {
                    botId: bot.id,
                    exchange: 'binance',
                    symbol: bot.symbol,
                    clientOrderId: generateClientOrderId(bot.id, 1),
                    exchangeOrderId: null,
                    submittedAt: null,
                    side: 'buy',
                    type: 'limit',
                    status: 'NEW',
                    price: '95.00',
                    amount: '0.10000000',
                    filledAmount: '0',
                    intentSeq: 1,
                },
            });

            const simulator = new ExchangeSimulator();
            simulator.setTicker(bot.symbol, '94');
            simulator.setBalance('USDT', '10000');

            const executor = createSimulatorExecutor(simulator);

            await processTriggerOrder(bot.id, { executor, tickerPrice: '94' });

            expect(executor.getCreateOrderCallCount()).toBe(0);

            const afterOrder = await prisma.order.findUnique({ where: { id: outboxOrder.id } });
            expect(afterOrder!.exchangeOrderId).toBeNull();
            expect(afterOrder!.submittedAt).toBeNull();
        }
    });

    /**
     * 验收 3：完整闭环（fill → reconcile → 下一腿），重启不重复
     * 
     * 流程：
     * 1) WAITING_TRIGGER 触发 BUY 下单（intentSeq=1）
     * 2) Simulator 模拟成交
     * 3) reconcile 把本地订单推进到 FILLED 并写 avgFillPrice
     * 4) processTriggerOrder 基于 avgFillPrice 生成 SELL（intentSeq=2）
     * 5) 重启后不重复 createOrder
     */
    it('should create reverse leg after fill+reconcile and be restart-safe', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'TRIG-TEST3/USDT',
                configJson: gridConfig,
                status: 'WAITING_TRIGGER',
                statusVersion: 5,
            },
        });

        const expectedBuyClientOrderId = generateClientOrderId(bot.id, 1);
        const expectedSellClientOrderId = generateClientOrderId(bot.id, 2);

        const simulator = new ExchangeSimulator();
        simulator.setTicker(bot.symbol, '94'); // <= buyTrigger 95，触发买入
        simulator.setBalance('USDT', '10000');

        const executor = createSimulatorExecutor(simulator);

        // 1) 触发 BUY
        await processTriggerOrder(bot.id, { executor, tickerPrice: '94' });
        expect(executor.getCreateOrderCallCount()).toBe(1);

        const buyOrder = await prisma.order.findFirst({
            where: { botId: bot.id, side: 'buy' },
            orderBy: { createdAt: 'desc' },
        });
        expect(buyOrder).toBeDefined();
        expect(buyOrder!.clientOrderId).toBe(expectedBuyClientOrderId);
        expect(buyOrder!.exchangeOrderId).toBeTruthy();

        // 2) 模拟成交（按更优价格 94 成交）
        simulator.simulateFill(buyOrder!.exchangeOrderId!, buyOrder!.amount, '94');

        // 3) reconcile 推进本地订单为 FILLED，并写 avgFillPrice
        const rec = await reconcileBot(bot.id, { executor });
        expect(rec.success).toBe(true);

        const afterBuy = await prisma.order.findUnique({ where: { id: buyOrder!.id } });
        expect(afterBuy!.status).toBe('FILLED');
        expect(afterBuy!.avgFillPrice).toBe('94.00000000');

        // 4) 生成下一腿 SELL：94 * 1.05 = 98.70
        simulator.setTicker(bot.symbol, '98');
        await processTriggerOrder(bot.id, { executor, tickerPrice: '98' });
        expect(executor.getCreateOrderCallCount()).toBe(2);

        const sellOrder = await prisma.order.findFirst({
            where: { botId: bot.id, side: 'sell' },
            orderBy: { createdAt: 'desc' },
        });
        expect(sellOrder).toBeDefined();
        expect(sellOrder!.clientOrderId).toBe(expectedSellClientOrderId);
        expect(sellOrder!.intentSeq).toBe(2);
        expect(sellOrder!.price).toBe('98.70');
        expect(sellOrder!.submittedAt).not.toBeNull();
        expect(sellOrder!.exchangeOrderId).toBeTruthy();

        // 5) 重启：新 executor，不应重复 createOrder
        const executor2 = createSimulatorExecutor(simulator);
        await processTriggerOrder(bot.id, { executor: executor2, tickerPrice: '98' });
        expect(executor2.getCreateOrderCallCount()).toBe(0);

        const sellOrders = await prisma.order.findMany({ where: { botId: bot.id, side: 'sell' } });
        expect(sellOrders.length).toBe(1);
        expect(sellOrders[0]!.clientOrderId).toBe(expectedSellClientOrderId);
    });

    // ========================================================================
    // 边界验收测试
    // ========================================================================

    /**
     * #4 重启 mid-submit（Outbox 核心幂等）
     * 
     * 场景：落库意图后、提交前重启（submittedAt=null, exchangeOrderId=null）
     * 
     * 断言：
     * - 重启后应重试提交同一个 clientOrderId
     * - 不应创建新意图
     * - callCount 应为 1（重试提交）
     */
    it('should retry same clientOrderId on restart mid-submit', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'TRIG-RESTART/USDT',
                configJson: gridConfig,
                status: 'RUNNING',
                statusVersion: 6,
            },
        });

        const expectedClientOrderId = generateClientOrderId(bot.id, 1);

        // 模拟：意图已落库但未提交（submittedAt=null, exchangeOrderId=null）
        await prisma.order.create({
            data: {
                botId: bot.id,
                exchange: 'binance',
                symbol: 'TRIG-RESTART/USDT',
                clientOrderId: expectedClientOrderId,
                exchangeOrderId: null,
                submittedAt: null,
                side: 'buy',
                type: 'limit',
                price: '95.00',
                amount: '10',
                filledAmount: '0',
                status: 'NEW',
                intentSeq: 1,
            },
        });

        const simulator = new ExchangeSimulator();
        simulator.setTicker('TRIG-RESTART/USDT', '94');
        simulator.setBalance('USDT', '10000');

        const executor = createSimulatorExecutor(simulator);

        // Act：重启后的 tick
        await processTriggerOrder(bot.id, { executor, tickerPrice: '94' });

        // Assert：重试提交同一个 clientOrderId
        expect(executor.getCreateOrderCallCount()).toBe(1);

        const orders = await prisma.order.findMany({ where: { botId: bot.id } });
        expect(orders.length).toBe(1); // 不创建新意图
        expect(orders[0].clientOrderId).toBe(expectedClientOrderId);
        expect(orders[0].exchangeOrderId).toBeTruthy(); // 已提交
        expect(orders[0].submittedAt).not.toBeNull();
    });

    /**
     * #2 部分成交推进
     * 
     * 场景：订单部分成交（filledAmount < amount）
     * 
     * 断言：
     * - reconcile 应推进为 PARTIALLY_FILLED（非 FILLED）
     * - 不应触发下一腿
     */
    it('should not trigger next leg when order is PARTIALLY_FILLED', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'TRIG-PARTIAL/USDT',
                configJson: gridConfig,
                status: 'RUNNING',
                statusVersion: 6,
            },
        });

        const expectedClientOrderId = generateClientOrderId(bot.id, 1);

        const simulator = new ExchangeSimulator();
        simulator.setTicker('TRIG-PARTIAL/USDT', '94');
        simulator.setBalance('USDT', '10000');

        const executor = createSimulatorExecutor(simulator);

        // 1) 创建并提交订单
        const order = await simulator.createOrder({
            symbol: 'TRIG-PARTIAL/USDT',
            side: 'buy',
            type: 'limit',
            price: '94',
            amount: '10',
            clientOrderId: expectedClientOrderId,
        });

        // 在 DB 创建对应订单
        await prisma.order.create({
            data: {
                botId: bot.id,
                exchange: 'binance',
                symbol: 'TRIG-PARTIAL/USDT',
                clientOrderId: expectedClientOrderId,
                exchangeOrderId: order.exchangeOrderId,
                submittedAt: new Date(),
                side: 'buy',
                type: 'limit',
                price: '94',
                amount: '10',
                filledAmount: '0',
                status: 'NEW',
                intentSeq: 1,
            },
        });

        // 2) 模拟部分成交（5/10）
        simulator.simulateFill(order.exchangeOrderId, '5', '94');

        // 3) reconcile 应推进为 PARTIALLY_FILLED
        await reconcileBot(bot.id, { executor });

        const partialOrder = await prisma.order.findFirst({
            where: { botId: bot.id, clientOrderId: expectedClientOrderId },
        });
        expect(partialOrder!.status).toBe('PARTIALLY_FILLED');
        expect(partialOrder!.filledAmount).toBe('5.00000000');

        // 4) processTriggerOrder 不应触发下一腿
        await processTriggerOrder(bot.id, { executor, tickerPrice: '94' });

        // 不应创建新订单（因为还有 open order）
        const orders = await prisma.order.findMany({ where: { botId: bot.id } });
        expect(orders.length).toBe(1);
    });

    it('should mark bot ERROR when order amount below minAmount', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'MIN-AMOUNT/USDT',
                configJson: gridConfig, // orderQuantity: 10
                status: 'WAITING_TRIGGER',
            },
        });

        const simulator = new ExchangeSimulator();
        simulator.setTicker('MIN-AMOUNT/USDT', '90');
        simulator.setBalance('USDT', '10000');
        const executor = createSimulatorExecutor(simulator);

        // 传入 marketInfo，minAmount = 100（订单数量 10 < 100）
        await processTriggerOrder(bot.id, {
            executor,
            tickerPrice: '90',
            marketInfo: {
                symbol: 'MIN-AMOUNT/USDT',
                pricePrecision: 2,
                amountPrecision: 8,
                minAmount: '100', // 触发阻断
                minNotional: '0',
            },
        });

        const updatedBot = await prisma.bot.findUnique({ where: { id: bot.id } });
        expect(updatedBot!.status).toBe('ERROR');
        expect(updatedBot!.lastError).toContain('BELOW_MIN_AMOUNT');

        // 不应创建订单
        const orders = await prisma.order.findMany({ where: { botId: bot.id } });
        expect(orders.length).toBe(0);
    });

    it('should mark bot ERROR when order notional below minNotional', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'MIN-NOTIONAL/USDT',
                configJson: gridConfig, // orderQuantity: 10, price ~95 → notional ~950
                status: 'WAITING_TRIGGER',
            },
        });

        const simulator = new ExchangeSimulator();
        simulator.setTicker('MIN-NOTIONAL/USDT', '90');
        simulator.setBalance('USDT', '10000');
        const executor = createSimulatorExecutor(simulator);

        // 传入 marketInfo，minNotional = 1000（notional 10*95=950 < 1000）
        await processTriggerOrder(bot.id, {
            executor,
            tickerPrice: '90',
            marketInfo: {
                symbol: 'MIN-NOTIONAL/USDT',
                pricePrecision: 2,
                amountPrecision: 8,
                minAmount: '0',
                minNotional: '1000', // 触发阻断
            },
        });

        const updatedBot = await prisma.bot.findUnique({ where: { id: bot.id } });
        expect(updatedBot!.status).toBe('ERROR');
        expect(updatedBot!.lastError).toContain('BELOW_MIN_NOTIONAL');

        // 不应创建订单
        const orders = await prisma.order.findMany({ where: { botId: bot.id } });
        expect(orders.length).toBe(0);
    });

    it('should NOT create order when price is out of bounds (BoundsGate)', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'BOUND/USDT',
                configJson: gridConfigWithBounds,
                status: 'WAITING_TRIGGER',
                statusVersion: 10,
            },
        });

        const simulator = new ExchangeSimulator();
        simulator.setBalance('USDT', '10000');
        simulator.setBalance('BOUND', '100');
        const executor = createSimulatorExecutor(simulator);

        // 价格 200：超过 priceMax=150，即使超过卖出触发线也必须跳过
        await processTriggerOrder(bot.id, { executor, tickerPrice: '200' });
        expect(executor.getCreateOrderCallCount()).toBe(0);

        const ordersAfterBlocked = await prisma.order.findMany({ where: { botId: bot.id } });
        expect(ordersAfterBlocked.length).toBe(0);

        // 价格回到 140：在范围内且 >= sellTrigger(105)，允许下单
        await processTriggerOrder(bot.id, { executor, tickerPrice: '140' });
        expect(executor.getCreateOrderCallCount()).toBe(1);

        const ordersAfterAllowed = await prisma.order.findMany({ where: { botId: bot.id } });
        expect(ordersAfterAllowed.length).toBe(1);
    });

    it('should transition bot to ERROR after max retries on rate limit (ACC-EX-002)', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-06T00:00:00Z'));
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'RATE-LIMIT/USDT',
                configJson: gridConfig,
                status: 'WAITING_TRIGGER',
            },
        });

        let createOrderCalls = 0;
        const alwaysRateLimitExecutor = {
            async fetchOpenOrders() {
                return [];
            },
            async fetchOpenOrdersFull() {
                return [];
            },
            async fetchMyTrades() {
                return [];
            },
            async cancelOrder() {
                return;
            },
            async createOrder() {
                createOrderCalls++;
                throw new RateLimitError(2000);
            },
        } as const;

        // 第一次：会创建 outbox 订单并尝试提交（失败，进入退避）
        await processTriggerOrder(bot.id, { executor: alwaysRateLimitExecutor as any, tickerPrice: '90' });
        expect(createOrderCalls).toBe(1);

        // 后续重试：推进时间，直到达到 maxRetries=5
        for (let i = 0; i < 4; i++) {
            vi.setSystemTime(new Date(Date.now() + 60_000));
            await processTriggerOrder(bot.id, { executor: alwaysRateLimitExecutor as any, tickerPrice: '90' });
        }

        expect(createOrderCalls).toBe(5);

        // 不应产生重复订单意图
        const orders = await prisma.order.findMany({ where: { botId: bot.id } });
        expect(orders.length).toBe(1);
        expect(orders[0]!.submittedAt).toBeNull();

        const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
        expect(afterBot!.status).toBe('ERROR');
        expect(afterBot!.lastError).toContain('ORDER_SUBMIT_FAILED');

        randomSpy.mockRestore();
        vi.useRealTimers();
    });
});
