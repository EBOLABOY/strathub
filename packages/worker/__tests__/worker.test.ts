/**
 * Worker C0 验收测试
 * 
 * 3 条锁口径：
 * 1. 不触发不 bump
 * 2. 触发一次进 STOPPING
 * 3. 503 时不改状态
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { prisma } from '@crypto-strategy-hub/database';
import { runOnce, tick, clearProviderCache, type WorkerDeps, type WorkerConfig, type MarketDataProvider } from '../src/worker.js';
import type { PreviewMarketInfo, PreviewTickerInfo, PreviewBalanceInfo } from '@crypto-strategy-hub/shared';

// ============================================================================
// Test Fixtures
// ============================================================================

let testUserId: string;
let testExchangeAccountId: string;

const autoCloseConfig = JSON.stringify({
    trigger: {
        gridType: 'percent',
        basePriceType: 'manual',
        basePrice: '600',
        riseSell: '1',
        fallBuy: '1',
    },
    order: { orderType: 'limit' },
    sizing: {
        amountMode: 'amount',
        gridSymmetric: true,
        symmetric: { orderQuantity: '100' },
    },
    risk: {
        enableAutoClose: true,
        autoCloseDrawdownPercent: '5', // 阈值 = 600 * 0.95 = 570
    },
});

// Mock providers
const normalProvider: MarketDataProvider = {
    async getMarketInfo(symbol) {
        return { symbol, pricePrecision: 2, amountPrecision: 4, minAmount: '0.01', minNotional: '10' };
    },
    async getTicker() {
        return { last: '580.00' }; // 高于阈值，不触发
    },
    async getBalance() {
        return undefined;
    },
};

const triggerProvider: MarketDataProvider = {
    async getMarketInfo(symbol) {
        return { symbol, pricePrecision: 2, amountPrecision: 4, minAmount: '0.01', minNotional: '10' };
    },
    async getTicker() {
        return { last: '500.00' }; // 低于阈值，触发
    },
    async getBalance() {
        return undefined;
    },
};

const failingProvider: MarketDataProvider = {
    async getMarketInfo() {
        throw new Error('Exchange unavailable');
    },
    async getTicker() {
        throw new Error('Exchange unavailable');
    },
    async getBalance() {
        return undefined;
    },
};

// ============================================================================
// Setup/Cleanup
// ============================================================================

beforeAll(async () => {
    const user = await prisma.user.create({
        data: {
            email: `test-worker-${Date.now()}@test.com`,
            passwordHash: 'test-hash',
        },
    });
    testUserId = user.id;

    const account = await prisma.exchangeAccount.create({
        data: {
            userId: testUserId,
            exchange: 'binance',
            name: 'test-worker-account',
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
    clearProviderCache();
});

// ============================================================================
// Tests
// ============================================================================

describe('Worker C0 验收测试', () => {
    describe('runOnce', () => {
        it('should not bump statusVersion when price above threshold', async () => {
            // 创建 RUNNING bot
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: autoCloseConfig,
                    status: 'RUNNING',
                    statusVersion: 5,
                    autoCloseReferencePrice: '600',
                },
            });

            const deps: WorkerDeps = {
                providerFactory: {
                    async createProvider() {
                        return normalProvider;
                    },
                },
                checkAndTriggerAutoClose: vi.fn(async () => ({
                    triggered: false,
                    previouslyTriggered: false,
                })),
            };

            const result = await runOnce(bot.id, deps);

            expect(result.success).toBe(true);
            expect(deps.checkAndTriggerAutoClose).toHaveBeenCalledOnce();

            // 验证 statusVersion 没变
            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.statusVersion).toBe(5);
        });

        it('should trigger AutoClose and transition to STOPPING', async () => {
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: autoCloseConfig,
                    status: 'RUNNING',
                    statusVersion: 5,
                    autoCloseReferencePrice: '600',
                },
            });

            const deps: WorkerDeps = {
                providerFactory: {
                    async createProvider() {
                        return triggerProvider;
                    },
                },
                checkAndTriggerAutoClose: vi.fn(async (botId) => {
                    // 模拟真实的 AutoClose 行为
                    await prisma.bot.update({
                        where: { id: botId },
                        data: {
                            status: 'STOPPING',
                            statusVersion: { increment: 1 },
                            autoCloseTriggeredAt: new Date(),
                            autoCloseReason: 'AUTO_CLOSE',
                        },
                    });
                    return {
                        triggered: true,
                        previouslyTriggered: false,
                        newStatus: 'STOPPING',
                    };
                }),
            };

            const result = await runOnce(bot.id, deps);

            expect(result.success).toBe(true);

            // 验证状态变为 STOPPING
            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.status).toBe('STOPPING');
            expect(afterBot!.statusVersion).toBe(6);
            expect(afterBot!.autoCloseTriggeredAt).not.toBeNull();
        });

        it('should not change status when provider throws 503', async () => {
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: autoCloseConfig,
                    status: 'RUNNING',
                    statusVersion: 5,
                    autoCloseReferencePrice: '600',
                },
            });

            const deps: WorkerDeps = {
                providerFactory: {
                    async createProvider() {
                        return failingProvider;
                    },
                },
                checkAndTriggerAutoClose: vi.fn(async () => {
                    throw new Error('503 EXCHANGE_UNAVAILABLE');
                }),
            };

            const result = await runOnce(bot.id, deps);

            // 应该返回失败但不崩溃
            expect(result.success).toBe(false);
            expect(result.error).toContain('503');

            // 验证状态没变
            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.status).toBe('RUNNING');
            expect(afterBot!.statusVersion).toBe(5);
        });
    });

    describe('tick', () => {
        it('should process multiple bots', async () => {
            // 创建 2 个 RUNNING bot
            await prisma.bot.createMany({
                data: [
                    {
                        userId: testUserId,
                        exchangeAccountId: testExchangeAccountId,
                        symbol: 'BNB/USDT',
                        configJson: autoCloseConfig,
                        status: 'RUNNING',
                        autoCloseReferencePrice: '600',
                    },
                    {
                        userId: testUserId,
                        exchangeAccountId: testExchangeAccountId,
                        symbol: 'ETH/USDT',
                        configJson: autoCloseConfig,
                        status: 'WAITING_TRIGGER',
                        autoCloseReferencePrice: '600',
                    },
                ],
            });

            const checkFn = vi.fn(async () => ({ triggered: false }));

            const deps: WorkerDeps = {
                providerFactory: {
                    async createProvider() {
                        return normalProvider;
                    },
                },
                checkAndTriggerAutoClose: checkFn,
            };

            const config: WorkerConfig = {
                intervalMs: 1000,
                maxBotsPerTick: 10,
                providerCacheMaxSize: 100,
            };

            const result = await tick(deps, config);

            expect(result.processed).toBe(2);
            expect(result.errors).toBe(0);
            expect(checkFn).toHaveBeenCalledTimes(2);
        });

        it('should run reconcile before risk-check when injected', async () => {
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: autoCloseConfig,
                    status: 'RUNNING',
                    statusVersion: 1,
                    autoCloseReferencePrice: '600',
                },
            });

            const reconcileBot = vi.fn(async (_botId: string, _deps: any) => ({ success: true }));
            const checkFn = vi.fn(async () => ({ triggered: false }));

            // 创建模拟 executorFactory
            const mockExecutor = { createOrder: vi.fn() } as any;
            const executorFactory = vi.fn(async () => ({ simulator: {} as any, executor: mockExecutor }));

            const deps: WorkerDeps = {
                providerFactory: {
                    async createProvider() {
                        return normalProvider;
                    },
                },
                executorFactory,
                reconcileBot,
                checkAndTriggerAutoClose: checkFn,
            };

            const config: WorkerConfig = {
                intervalMs: 1000,
                maxBotsPerTick: 10,
                providerCacheMaxSize: 100,
            };

            const result = await tick(deps, config);

            expect(result.processed).toBe(1);
            expect(result.errors).toBe(0);
            expect(reconcileBot).toHaveBeenCalledOnce();
            expect(reconcileBot).toHaveBeenCalledWith(bot.id, { executor: mockExecutor });
            expect(checkFn).toHaveBeenCalledOnce();
        });

        it('should skip risk-check when reconcile fails', async () => {
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: autoCloseConfig,
                    status: 'RUNNING',
                    statusVersion: 1,
                    autoCloseReferencePrice: '600',
                },
            });

            const reconcileBot = vi.fn(async (_botId: string, _deps: any) => ({ success: false, error: '503 EXCHANGE_UNAVAILABLE' }));
            const checkFn = vi.fn(async () => ({ triggered: false }));

            const mockExecutor = { createOrder: vi.fn() } as any;
            const executorFactory = vi.fn(async () => ({ simulator: {} as any, executor: mockExecutor }));

            const deps: WorkerDeps = {
                providerFactory: {
                    async createProvider() {
                        return normalProvider;
                    },
                },
                executorFactory,
                reconcileBot,
                checkAndTriggerAutoClose: checkFn,
            };

            const config: WorkerConfig = {
                intervalMs: 1000,
                maxBotsPerTick: 10,
                providerCacheMaxSize: 100,
            };

            const result = await tick(deps, config);

            expect(result.processed).toBe(1);
            expect(result.errors).toBe(1);
            expect(reconcileBot).toHaveBeenCalledOnce();
            expect(checkFn).not.toHaveBeenCalled();
        });

        it('should skip PAUSED/STOPPED bots', async () => {
            // 创建 1 个 RUNNING，1 个 PAUSED
            await prisma.bot.createMany({
                data: [
                    {
                        userId: testUserId,
                        exchangeAccountId: testExchangeAccountId,
                        symbol: 'BNB/USDT',
                        configJson: autoCloseConfig,
                        status: 'RUNNING',
                        autoCloseReferencePrice: '600',
                    },
                    {
                        userId: testUserId,
                        exchangeAccountId: testExchangeAccountId,
                        symbol: 'ETH/USDT',
                        configJson: autoCloseConfig,
                        status: 'PAUSED',
                        autoCloseReferencePrice: '600',
                    },
                ],
            });

            const checkFn = vi.fn(async () => ({ triggered: false }));

            const deps: WorkerDeps = {
                providerFactory: {
                    async createProvider() {
                        return normalProvider;
                    },
                },
                checkAndTriggerAutoClose: checkFn,
            };

            const config: WorkerConfig = {
                intervalMs: 1000,
                maxBotsPerTick: 10,
                providerCacheMaxSize: 100,
            };

            const result = await tick(deps, config);

            // 只处理了 1 个（RUNNING）
            expect(result.processed).toBe(1);
            expect(checkFn).toHaveBeenCalledTimes(1);
        });
    });
});
