/**
 * ACC-RISK-002: AutoClose HTTP 级别测试
 * 
 * 测试 risk-check endpoint：
 * 1. 首次触发进入 STOPPING
 * 2. 重复检查不二次 bump
 * 3. ticker 不可用返回 503
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { prisma } from '@crypto-strategy-hub/database';
import jwt from 'jsonwebtoken';
import type { MarketDataProvider } from '../src/services/preview-validation.js';

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production';

function createTestToken(userId: string): string {
    return jwt.sign({ userId, email: 'test@test.com', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });
}

// Normal provider（价格高于阈值，不触发）
const normalProvider: MarketDataProvider = {
    async getMarketInfo(symbol: string) {
        return {
            symbol,
            pricePrecision: 2,
            amountPrecision: 4,
            minAmount: '0.01',
            minNotional: '10',
        };
    },
    async getTicker(_symbol: string) {
        return { last: '580.00' }; // 高于 referencePrice * 0.95
    },
    async getBalance(_symbol: string) {
        return undefined;
    },
};

// Trigger provider（价格低于阈值，触发）
const triggerProvider: MarketDataProvider = {
    async getMarketInfo(symbol: string) {
        return {
            symbol,
            pricePrecision: 2,
            amountPrecision: 4,
            minAmount: '0.01',
            minNotional: '10',
        };
    },
    async getTicker(_symbol: string) {
        return { last: '500.00' }; // 低于 600 * 0.95 = 570
    },
    async getBalance(_symbol: string) {
        return undefined;
    },
};

// Failing provider（ticker 不可用）
const failingProvider: MarketDataProvider = {
    async getMarketInfo(symbol: string) {
        return {
            symbol,
            pricePrecision: 2,
            amountPrecision: 4,
            minAmount: '0.01',
            minNotional: '10',
        };
    },
    async getTicker(_symbol: string) {
        throw new Error('Ticker service unavailable');
    },
    async getBalance(_symbol: string) {
        return undefined;
    },
};

// Invalid ticker provider（返回非数字价格）
const invalidTickerProvider: MarketDataProvider = {
    async getMarketInfo(symbol: string) {
        return {
            symbol,
            pricePrecision: 2,
            amountPrecision: 4,
            minAmount: '0.01',
            minNotional: '10',
        };
    },
    async getTicker(_symbol: string) {
        return { last: 'abc' }; // 非数字价格
    },
    async getBalance(_symbol: string) {
        return undefined;
    },
};

async function createTestApp(provider: MarketDataProvider) {
    const { createBotsRouter } = await import('../src/routes/bots.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');

    // 创建一个返回指定 provider 的 factory
    const testFactory = {
        async createProvider() {
            return provider;
        },
    };

    const app = express();
    app.use(express.json());
    app.use('/api/bots', createBotsRouter({ providerFactory: testFactory }));
    app.use(errorHandler);

    return app;
}

describe('ACC-RISK-002: AutoClose HTTP Tests', () => {
    let testUserId: string;
    let testToken: string;
    let testExchangeAccountId: string;

    // 带 AutoClose 配置的 config
    const autoCloseConfig = JSON.stringify({
        trigger: {
            gridType: 'percent',
            basePriceType: 'manual',
            basePrice: '600', // 参考价 600
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
            autoCloseDrawdownPercent: '5', // 阈值价格 = 600 * 0.95 = 570
        },
    });

    beforeAll(async () => {
        // 创建测试用户
        const user = await prisma.user.create({
            data: {
                email: `test-autoclose-${Date.now()}@test.com`,
                passwordHash: 'test-hash',
            },
        });
        testUserId = user.id;
        testToken = createTestToken(testUserId);

        // 创建测试交易所账户
        const exchangeAccount = await prisma.exchangeAccount.create({
            data: {
                userId: testUserId,
                exchange: 'binance',
                name: 'test-autoclose-account',
                encryptedCredentials: '{}',
            },
        });
        testExchangeAccountId = exchangeAccount.id;
    });

    afterAll(async () => {
        await prisma.bot.deleteMany({ where: { userId: testUserId } });
        await prisma.exchangeAccount.deleteMany({ where: { userId: testUserId } });
        await prisma.user.delete({ where: { id: testUserId } });
    });

    beforeEach(async () => {
        await prisma.bot.deleteMany({ where: { userId: testUserId } });
    });

    describe('POST /api/bots/:botId/risk-check', () => {
        it('should trigger AUTO_CLOSE when price below threshold', async () => {
            // 创建 RUNNING bot 并设置 referencePrice
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: autoCloseConfig,
                    status: 'RUNNING',
                    statusVersion: 5,
                    autoCloseReferencePrice: '600', // 冻结的参考价
                },
            });

            const app = await createTestApp(triggerProvider);

            const res = await request(app)
                .post(`/api/bots/${bot.id}/risk-check`)
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            expect(res.status).toBe(200);
            expect(res.body.triggered).toBe(true);
            expect(res.body.newStatus).toBe('STOPPING');

            // 验证数据库状态
            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.status).toBe('STOPPING');
            expect(afterBot!.statusVersion).toBe(6);
            expect(afterBot!.autoCloseTriggeredAt).not.toBeNull();
            expect(afterBot!.autoCloseReason).toBe('AUTO_CLOSE');
        });

        it('should not trigger again after already triggered', async () => {
            // 创建 RUNNING bot（已触发）
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: autoCloseConfig,
                    status: 'RUNNING',
                    statusVersion: 5,
                    autoCloseReferencePrice: '600',
                    autoCloseTriggeredAt: new Date(),
                    autoCloseReason: 'AUTO_CLOSE',
                },
            });

            const app = await createTestApp(triggerProvider);

            const res = await request(app)
                .post(`/api/bots/${bot.id}/risk-check`)
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            expect(res.status).toBe(200);
            expect(res.body.triggered).toBe(false);
            expect(res.body.previouslyTriggered).toBe(true);

            // 验证 statusVersion 没涨
            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.statusVersion).toBe(5);
        });

        it('should not trigger when price above threshold', async () => {
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: autoCloseConfig,
                    status: 'RUNNING',
                    statusVersion: 3,
                    autoCloseReferencePrice: '600',
                },
            });

            const app = await createTestApp(normalProvider);

            const res = await request(app)
                .post(`/api/bots/${bot.id}/risk-check`)
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            expect(res.status).toBe(200);
            expect(res.body.triggered).toBe(false);

            // 验证状态没变
            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.status).toBe('RUNNING');
            expect(afterBot!.statusVersion).toBe(3);
        });

        it('should return 503 when ticker unavailable', async () => {
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: autoCloseConfig,
                    status: 'RUNNING',
                    statusVersion: 3,
                    autoCloseReferencePrice: '600',
                },
            });

            const app = await createTestApp(failingProvider);

            const res = await request(app)
                .post(`/api/bots/${bot.id}/risk-check`)
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            expect(res.status).toBe(503);
            expect(res.body.code).toBe('EXCHANGE_UNAVAILABLE');

            // 验证状态没变
            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.status).toBe('RUNNING');
            expect(afterBot!.statusVersion).toBe(3);
        });

        it('should return 503 when ticker returns invalid price', async () => {
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: autoCloseConfig,
                    status: 'RUNNING',
                    statusVersion: 3,
                    autoCloseReferencePrice: '600',
                },
            });

            const app = await createTestApp(invalidTickerProvider);

            const res = await request(app)
                .post(`/api/bots/${bot.id}/risk-check`)
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            expect(res.status).toBe(503);
            expect(res.body.code).toBe('EXCHANGE_UNAVAILABLE');

            // 验证状态没变
            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.status).toBe('RUNNING');
            expect(afterBot!.statusVersion).toBe(3);
        });
    });
});
