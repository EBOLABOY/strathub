/**
 * 503 EXCHANGE_UNAVAILABLE HTTP 测试
 * 
 * 测试 MarketDataProvider 注入和 503 错误处理
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { prisma } from '@crypto-strategy-hub/database';
import jwt from 'jsonwebtoken';
import type { MarketDataProvider } from '../src/services/preview-validation.js';

// 创建会失败的 provider
const failingProvider: MarketDataProvider = {
    async getMarketInfo(_symbol: string) {
        throw new Error('Exchange connection failed');
    },
    async getTicker(_symbol: string) {
        throw new Error('Ticker unavailable');
    },
    async getBalance(_symbol: string) {
        return undefined;
    },
};

// 部分失败的 provider（market OK，ticker fail）
const partialFailProvider: MarketDataProvider = {
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
        throw new Error('Ticker service down');
    },
    async getBalance(_symbol: string) {
        return undefined;
    },
};

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production';

function createTestToken(userId: string): string {
    return jwt.sign({ userId, email: 'test@test.com', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });
}

// 创建使用注入 provider 的 app
async function createTestAppWithProvider(provider: MarketDataProvider) {
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

describe('503 EXCHANGE_UNAVAILABLE HTTP Tests', () => {
    let testUserId: string;
    let testToken: string;
    let testBotId: string;

    beforeAll(async () => {
        // 创建测试用户
        const user = await prisma.user.create({
            data: {
                email: `test-503-${Date.now()}@test.com`,
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
                name: 'test-503-account',
                encryptedCredentials: '{}',
            },
        });

        // 创建测试 Bot
        const validConfig = JSON.stringify({
            trigger: {
                gridType: 'percent',
                basePriceType: 'current',
                riseSell: '1',
                fallBuy: '1',
            },
            order: { orderType: 'limit' },
            sizing: {
                amountMode: 'amount',
                gridSymmetric: true,
                symmetric: { orderQuantity: '100' },
            },
        });

        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: exchangeAccount.id,
                symbol: 'TEST/USDT',
                configJson: validConfig,
                status: 'DRAFT',
            },
        });
        testBotId = bot.id;
    });

    afterAll(async () => {
        // 清理测试数据
        await prisma.bot.deleteMany({ where: { userId: testUserId } });
        await prisma.exchangeAccount.deleteMany({ where: { userId: testUserId } });
        await prisma.user.delete({ where: { id: testUserId } });
    });

    describe('POST /api/bots/:botId/preview with failing provider', () => {
        it('should return 503 when market info fails', async () => {
            const app = await createTestAppWithProvider(failingProvider);

            const res = await request(app)
                .post(`/api/bots/${testBotId}/preview`)
                .set('Authorization', `Bearer ${testToken}`)
                .send({});

            expect(res.status).toBe(503);
            expect(res.body.code).toBe('EXCHANGE_UNAVAILABLE');
            expect(res.body.error).toContain('market info');
        });

        it('should return 503 when ticker fails (after market info succeeds)', async () => {
            const app = await createTestAppWithProvider(partialFailProvider);

            const res = await request(app)
                .post(`/api/bots/${testBotId}/preview`)
                .set('Authorization', `Bearer ${testToken}`)
                .send({});

            expect(res.status).toBe(503);
            expect(res.body.code).toBe('EXCHANGE_UNAVAILABLE');
            expect(res.body.error).toContain('ticker');
        });
    });

    describe('POST /api/bots/:botId/start with failing provider', () => {
        it('should return 503 and not change status when exchange unavailable', async () => {
            const app = await createTestAppWithProvider(failingProvider);

            // 获取原始状态
            const beforeBot = await prisma.bot.findUnique({ where: { id: testBotId } });
            const beforeVersion = beforeBot!.statusVersion;

            const res = await request(app)
                .post(`/api/bots/${testBotId}/start`)
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            expect(res.status).toBe(503);
            expect(res.body.code).toBe('EXCHANGE_UNAVAILABLE');

            // 验证状态没有改变
            const afterBot = await prisma.bot.findUnique({ where: { id: testBotId } });
            expect(afterBot!.status).toBe('DRAFT');
            expect(afterBot!.statusVersion).toBe(beforeVersion);
        });
    });
});
