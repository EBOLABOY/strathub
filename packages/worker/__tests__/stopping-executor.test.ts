/**
 * STOPPING 执行器验收测试
 * 
 * 3 条锁口径：
 * 1. STOPPING + 有 open orders → cancel → STOPPED
 * 2. STOPPING + 503 → 状态不变
 * 3. STOPPING + 无 orders → 直接 STOPPED
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { prisma } from '@crypto-strategy-hub/database';
import { createProcessStoppingBot, createMockExecutor, type ExchangeExecutor, type OpenOrder } from '../src/stopping-executor.js';

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
            email: `test-stopping-${Date.now()}@test.com`,
            passwordHash: 'test-hash',
        },
    });
    testUserId = user.id;

    const account = await prisma.exchangeAccount.create({
        data: {
            userId: testUserId,
            exchange: 'binance',
            name: 'test-stopping-account',
            encryptedCredentials: '{}',
        },
    });
    testExchangeAccountId = account.id;
});

afterAll(async () => {
    await prisma.bot.deleteMany({ where: { userId: testUserId } });
    await prisma.exchangeAccount.deleteMany({ where: { userId: testUserId } });
    await prisma.user.delete({ where: { id: testUserId } });
});

beforeEach(async () => {
    await prisma.bot.deleteMany({ where: { userId: testUserId } });
});

// ============================================================================
// Tests
// ============================================================================

describe('STOPPING 执行器验收测试', () => {
    it('should cancel open orders and transition to STOPPED', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'BNB/USDT',
                configJson: dummyConfig,
                status: 'STOPPING',
                statusVersion: 5,
                runId: 'run-123',
            },
        });

        const mockOrders: OpenOrder[] = [
            { id: 'order-1', symbol: 'BNB/USDT', clientOrderId: 'gb1-test-1' },
            { id: 'order-2', symbol: 'BNB/USDT', clientOrderId: 'gb1-test-2' },
        ];
        const executor = createMockExecutor(mockOrders);
        const processStoppingBot = createProcessStoppingBot(executor);

        const result = await processStoppingBot(bot.id);

        expect(result.success).toBe(true);
        expect(result.newStatus).toBe('STOPPED');
        expect(result.canceledOrders).toBe(2);

        // 验证数据库状态
        const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
        expect(afterBot!.status).toBe('STOPPED');
        expect(afterBot!.statusVersion).toBe(6);
        expect(afterBot!.runId).toBeNull();
    });

    it('should not change status when exchange unavailable', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'BNB/USDT',
                configJson: dummyConfig,
                status: 'STOPPING',
                statusVersion: 5,
                runId: 'run-456',
            },
        });

        // 创建失败的 executor
        const failingExecutor: ExchangeExecutor = {
            async fetchOpenOrders() {
                throw new Error('Exchange unavailable');
            },
            async cancelOrder() {
                throw new Error('Exchange unavailable');
            },
            async createOrder() {
                throw new Error('Exchange unavailable');
            },
            async fetchBalance() {
                return {};
            },
        };
        const processStoppingBot = createProcessStoppingBot(failingExecutor);

        const result = await processStoppingBot(bot.id);

        expect(result.success).toBe(false);
        expect(result.error).toContain('503');

        // 验证状态没变
        const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
        expect(afterBot!.status).toBe('STOPPING');
        expect(afterBot!.statusVersion).toBe(5);
        expect(afterBot!.runId).toBe('run-456');
    });

    it('should transition to STOPPED when no open orders', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'BNB/USDT',
                configJson: dummyConfig,
                status: 'STOPPING',
                statusVersion: 5,
                runId: 'run-789',
            },
        });

        // 空 orders
        const executor = createMockExecutor([]);
        const processStoppingBot = createProcessStoppingBot(executor);

        const result = await processStoppingBot(bot.id);

        expect(result.success).toBe(true);
        expect(result.newStatus).toBe('STOPPED');
        expect(result.canceledOrders).toBe(0);

        // 验证数据库状态
        const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
        expect(afterBot!.status).toBe('STOPPED');
        expect(afterBot!.statusVersion).toBe(6);
        expect(afterBot!.runId).toBeNull();
    });

    it('should stay STOPPING when cancelOrder fails (partial cancel)', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'BNB/USDT',
                configJson: dummyConfig,
                status: 'STOPPING',
                statusVersion: 5,
                runId: 'run-partial',
            },
        });

        // fetchOpenOrders 成功，但第二个 cancel 失败
        let cancelCount = 0;
        const partialFailExecutor: ExchangeExecutor = {
            async fetchOpenOrders() {
                return [
                    { id: 'order-1', symbol: 'BNB/USDT' },
                    { id: 'order-2', symbol: 'BNB/USDT' },
                ];
            },
            async cancelOrder(orderId: string) {
                cancelCount++;
                if (orderId === 'order-2') {
                    throw new Error('Network timeout');
                }
            },
        };
        const processStoppingBot = createProcessStoppingBot(partialFailExecutor);

        const result = await processStoppingBot(bot.id);

        expect(result.success).toBe(false);
        expect(result.error).toContain('order-2');
        expect(result.canceledOrders).toBe(1); // 第一个成功了

        // 验证状态没变
        const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
        expect(afterBot!.status).toBe('STOPPING');
        expect(afterBot!.statusVersion).toBe(5);
        expect(afterBot!.runId).toBe('run-partial');
    });

    it('should transition to ERROR after exceeding max retries', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-06T10:00:00Z'));
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'BNB/USDT',
                configJson: dummyConfig,
                status: 'STOPPING',
                statusVersion: 5,
                runId: 'run-stop-fail',
            },
        });

        const alwaysFailExecutor: ExchangeExecutor = {
            async fetchOpenOrders() {
                throw new Error('Exchange unavailable');
            },
            async cancelOrder() {
                throw new Error('Exchange unavailable');
            },
        };
        const processStoppingBot = createProcessStoppingBot(alwaysFailExecutor);

        // 前 4 次：保持 STOPPING
        for (let i = 0; i < 4; i++) {
            const result = await processStoppingBot(bot.id);
            expect(result.success).toBe(false);

            const midBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(midBot!.status).toBe('STOPPING');
            expect(midBot!.statusVersion).toBe(5);

            vi.setSystemTime(new Date(Date.now() + 60_000));
        }

        // 第 5 次：超限进入 ERROR
        const finalResult = await processStoppingBot(bot.id);
        expect(finalResult.success).toBe(false);
        expect(finalResult.newStatus).toBe('ERROR');

        const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
        expect(afterBot!.status).toBe('ERROR');
        expect(afterBot!.statusVersion).toBe(6);
        expect(afterBot!.lastError).toContain('STOPPING_FAILED');

        randomSpy.mockRestore();
        vi.useRealTimers();
    });

    it('should force-close position on STOP_LOSS and then STOPPED', async () => {
        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: 'BNB/USDT',
                configJson: dummyConfig,
                status: 'STOPPING',
                statusVersion: 5,
                runId: 'run-789',
                lastError: 'STOP_LOSS: last=500 < floorPrice=550',
            },
        });

        const executor: ExchangeExecutor = {
            async fetchOpenOrders() {
                return [];
            },
            async cancelOrder() {
                return;
            },
            async fetchBalance() {
                return {
                    BNB: { free: '1', locked: '0', total: '1' },
                    USDT: { free: '0', locked: '0', total: '0' },
                };
            },
            async createOrder(params) {
                return { exchangeOrderId: 'ex-close-1', clientOrderId: params.clientOrderId, status: 'FILLED' };
            },
        };

        const processStoppingBot = createProcessStoppingBot(executor);
        const result = await processStoppingBot(bot.id);

        expect(result.success).toBe(true);
        expect(result.newStatus).toBe('STOPPED');

        const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
        expect(afterBot!.status).toBe('STOPPED');
        expect(afterBot!.lastError).toContain('STOP_LOSS');

        const closeOrder = await prisma.order.findFirst({
            where: { botId: bot.id, clientOrderId: { startsWith: 'gb1c' } },
            orderBy: { createdAt: 'desc' },
        });
        expect(closeOrder).toBeTruthy();
        expect(closeOrder!.type).toBe('market');
        expect(closeOrder!.side).toBe('sell');
        expect(closeOrder!.status).toBe('FILLED');
        expect(closeOrder!.exchangeOrderId).toBe('ex-close-1');
    });
});
