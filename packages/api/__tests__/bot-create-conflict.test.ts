/**
 * Bot Create Conflict HTTP Test
 *
 * 验证：同一 exchangeAccountId + symbol 重复创建 -> 409 BOT_ALREADY_EXISTS
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '@crypto-strategy-hub/database';

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

describe('POST /api/bots conflict', () => {
    let testUserId: string;
    let testToken: string;
    let testExchangeAccountId: string;

    beforeAll(async () => {
        const user = await prisma.user.create({
            data: {
                email: `test-bot-conflict-${Date.now()}@test.com`,
                passwordHash: 'test-hash',
            },
        });
        testUserId = user.id;
        testToken = createTestToken(testUserId);

        const account = await prisma.exchangeAccount.create({
            data: {
                userId: testUserId,
                exchange: 'binance',
                name: 'test-bot-conflict-account',
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

    it('should return 409 BOT_ALREADY_EXISTS for duplicate (exchangeAccountId, symbol)', async () => {
        const app = await createTestApp();

        const configJson = JSON.stringify({
            trigger: { gridType: 'percent', basePriceType: 'current', riseSell: '1', fallBuy: '1' },
            order: { orderType: 'limit' },
            sizing: { amountMode: 'amount', gridSymmetric: true, symmetric: { orderQuantity: '100' } },
        });

        const res1 = await request(app)
            .post('/api/bots')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                exchangeAccountId: testExchangeAccountId,
                symbol: 'BNB/USDT',
                configJson,
            });

        expect(res1.status).toBe(201);

        const res2 = await request(app)
            .post('/api/bots')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                exchangeAccountId: testExchangeAccountId,
                symbol: 'BNB/USDT',
                configJson,
            });

        expect(res2.status).toBe(409);
        expect(res2.body.code).toBe('BOT_ALREADY_EXISTS');
    });
});

