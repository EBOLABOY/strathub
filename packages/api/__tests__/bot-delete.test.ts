/**
 * Bot Delete HTTP Test
 *
 * 验证：
 * - DRAFT/STOPPED/ERROR 允许删除
 * - RUNNING/PAUSED/WAITING_TRIGGER/STOPPING 等状态禁止删除
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

describe('DELETE /api/bots/:botId', () => {
    let testUserId: string;
    let testToken: string;
    let testExchangeAccountId: string;

    beforeAll(async () => {
        const user = await prisma.user.create({
            data: {
                email: `test-bot-delete-${Date.now()}@test.com`,
                passwordHash: 'test-hash',
            },
        });
        testUserId = user.id;
        testToken = createTestToken(testUserId);

        const account = await prisma.exchangeAccount.create({
            data: {
                userId: testUserId,
                exchange: 'binance',
                name: `test-bot-delete-account-${Date.now()}`,
                encryptedCredentials: '{}',
                isTestnet: true,
            },
        });
        testExchangeAccountId = account.id;
    });

    afterAll(async () => {
        await prisma.bot.deleteMany({ where: { userId: testUserId } });
        await prisma.exchangeAccount.deleteMany({ where: { userId: testUserId } });
        await prisma.user.delete({ where: { id: testUserId } });
    });

    it('should delete bot successfully when status is STOPPED', async () => {
        const app = await createTestApp();

        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: `STOPPED/USDT-${Date.now()}`,
                configJson: '{}',
                status: 'STOPPED',
            },
        });

        const res = await request(app)
            .delete(`/api/bots/${bot.id}`)
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(204);

        const deleted = await prisma.bot.findUnique({ where: { id: bot.id } });
        expect(deleted).toBeNull();
    });

    it('should return 409 INVALID_STATE_FOR_DELETE when status is RUNNING', async () => {
        const app = await createTestApp();

        const bot = await prisma.bot.create({
            data: {
                userId: testUserId,
                exchangeAccountId: testExchangeAccountId,
                symbol: `RUNNING/USDT-${Date.now()}`,
                configJson: '{}',
                status: 'RUNNING',
            },
        });

        const res = await request(app)
            .delete(`/api/bots/${bot.id}`)
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('INVALID_STATE_FOR_DELETE');

        const stillThere = await prisma.bot.findUnique({ where: { id: bot.id } });
        expect(stillThere).toBeTruthy();
    });
});

