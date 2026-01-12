/**
 * 状态机幂等 HTTP 测试
 * 
 * 测试重复操作不 bump statusVersion
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { prisma } from '@crypto-strategy-hub/database';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production';

function createTestToken(userId: string): string {
    return jwt.sign({ userId, email: 'test@test.com', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });
}

async function createTestApp() {
    const { createBotsRouter } = await import('../src/routes/bots.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');

    const app = express();
    app.use(express.json());
    app.use('/api/bots', createBotsRouter());
    app.use(errorHandler);

    return app;
}

describe('状态机幂等 HTTP Tests', () => {
    let app: express.Express;
    let testUserId: string;
    let testToken: string;
    let testExchangeAccountId: string;

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

    beforeAll(async () => {
        app = await createTestApp();

        const user = await prisma.user.create({
            data: {
                email: `test-idempotent-${Date.now()}@test.com`,
                passwordHash: 'test-hash',
            },
        });
        testUserId = user.id;
        testToken = createTestToken(testUserId);

        const exchangeAccount = await prisma.exchangeAccount.create({
            data: {
                userId: testUserId,
                exchange: 'binance',
                name: 'test-idempotent-account',
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

    describe('重复 pause 幂等', () => {
        it('should not bump statusVersion on duplicate pause', async () => {
            // 创建 PAUSED bot
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: validConfig,
                    status: 'PAUSED',
                    statusVersion: 10,
                },
            });

            // 重复 pause
            const res = await request(app)
                .post(`/api/bots/${bot.id}/pause`)
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            expect(res.status).toBe(200);

            // 验证 statusVersion 没变
            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.statusVersion).toBe(10);
        });
    });

    describe('重复 stop 幂等', () => {
        it('should not bump statusVersion on duplicate stop', async () => {
            // 创建 STOPPED bot
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: validConfig,
                    status: 'STOPPED',
                    statusVersion: 15,
                },
            });

            // 重复 stop
            const res = await request(app)
                .post(`/api/bots/${bot.id}/stop`)
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            expect(res.status).toBe(200);

            // 验证 statusVersion 没变
            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.statusVersion).toBe(15);
        });
    });

    describe('重复 start (已 RUNNING) 幂等', () => {
        it('should not bump statusVersion on duplicate start', async () => {
            // 创建 RUNNING bot
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: validConfig,
                    status: 'RUNNING',
                    statusVersion: 5,
                },
            });

            // 重复 start（幂等）
            const res = await request(app)
                .post(`/api/bots/${bot.id}/start`)
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            expect(res.status).toBe(200);

            // 验证 statusVersion 没变
            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.statusVersion).toBe(5);
        });
    });
});
