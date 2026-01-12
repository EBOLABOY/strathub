/**
 * ACC-RISK-001: Kill Switch 验收测试
 * 
 * 验收清单：
 * 1. Enable 后 start/resume 一律 423，且 statusVersion 不涨
 * 2. Enable 会把 RUNNING/WAITING_TRIGGER 推到 STOPPING
 * 3. PAUSED/DRAFT/STOPPED 完全不变
 * 4. 重复 enable/disable 幂等
 * 5. 并发 enable：最终一致
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

// 创建测试 app
async function createTestApp() {
    const { createBotsRouter } = await import('../src/routes/bots.js');
    const { killSwitchRouter } = await import('../src/routes/kill-switch.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');

    const app = express();
    app.use(express.json());
    app.use('/api/bots', createBotsRouter());
    app.use('/api/kill-switch', killSwitchRouter);
    app.use(errorHandler);

    return app;
}

describe('ACC-RISK-001: Kill Switch', () => {
    let app: express.Express;
    let testUserId: string;
    let testToken: string;
    let testExchangeAccountId: string;

    beforeAll(async () => {
        app = await createTestApp();

        // 创建测试用户
        const user = await prisma.user.create({
            data: {
                email: `test-killswitch-${Date.now()}@test.com`,
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
                name: 'test-killswitch-account',
                encryptedCredentials: '{}',
            },
        });
        testExchangeAccountId = exchangeAccount.id;
    });

    afterAll(async () => {
        // 清理测试数据
        await prisma.bot.deleteMany({ where: { userId: testUserId } });
        await prisma.exchangeAccount.deleteMany({ where: { userId: testUserId } });
        await prisma.user.delete({ where: { id: testUserId } });
    });

    beforeEach(async () => {
        // 重置 kill switch 状态
        await prisma.user.update({
            where: { id: testUserId },
            data: { killSwitchEnabled: false },
        });
        // 删除所有测试 bots
        await prisma.bot.deleteMany({ where: { userId: testUserId } });
    });

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

    describe('验收 1: Enable 后 start/resume 返回 423', () => {
        it('should return 423 KILL_SWITCH_LOCKED when start with kill switch enabled', async () => {
            // 创建一个 DRAFT bot
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: validConfig,
                    status: 'DRAFT',
                    statusVersion: 0,
                },
            });

            // 启用 kill switch
            await request(app)
                .post('/api/kill-switch/enable')
                .set('Authorization', `Bearer ${testToken}`)
                .send({ reason: 'TEST' });

            // 尝试 start
            const res = await request(app)
                .post(`/api/bots/${bot.id}/start`)
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            expect(res.status).toBe(423);
            expect(res.body.code).toBe('KILL_SWITCH_LOCKED');

            // 验证 statusVersion 不变
            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.statusVersion).toBe(0);
        });

        it('should return 423 for resume when kill switch enabled', async () => {
            // 创建一个 PAUSED bot（模拟需要 resume 的场景）
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: validConfig,
                    status: 'PAUSED',
                    statusVersion: 5,
                },
            });

            // 启用 kill switch
            await request(app)
                .post('/api/kill-switch/enable')
                .set('Authorization', `Bearer ${testToken}`)
                .send({});

            // 尝试 resume
            const res = await request(app)
                .post(`/api/bots/${bot.id}/resume`)
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            expect(res.status).toBe(423);
            expect(res.body.code).toBe('KILL_SWITCH_LOCKED');

            // 验证 statusVersion 不变
            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.statusVersion).toBe(5);
        });
    });

    describe('验收 2: Enable 把 RUNNING/WAITING_TRIGGER 推到 STOPPING', () => {
        it('should stop RUNNING bots when enable kill switch', async () => {
            // 创建 RUNNING bot
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: validConfig,
                    status: 'RUNNING',
                    statusVersion: 3,
                },
            });

            // 启用 kill switch
            const res = await request(app)
                .post('/api/kill-switch/enable')
                .set('Authorization', `Bearer ${testToken}`)
                .send({ reason: 'EMERGENCY' });

            expect(res.status).toBe(200);
            expect(res.body.affectedBots).toBe(1);

            // 验证 bot 进入 STOPPING
            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.status).toBe('STOPPING');
            expect(afterBot!.statusVersion).toBe(4);
            expect(afterBot!.lastError).toContain('KILL_SWITCH');
        });

        it('should stop WAITING_TRIGGER bots when enable kill switch', async () => {
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'ETH/USDT',
                    configJson: validConfig,
                    status: 'WAITING_TRIGGER',
                    statusVersion: 2,
                },
            });

            await request(app)
                .post('/api/kill-switch/enable')
                .set('Authorization', `Bearer ${testToken}`)
                .send({});

            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.status).toBe('STOPPING');
        });
    });

    describe('验收 3: PAUSED/DRAFT/STOPPED 完全不变', () => {
        it('should not affect PAUSED bots', async () => {
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: validConfig,
                    status: 'PAUSED',
                    statusVersion: 5,
                },
            });

            await request(app)
                .post('/api/kill-switch/enable')
                .set('Authorization', `Bearer ${testToken}`)
                .send({});

            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.status).toBe('PAUSED');
            expect(afterBot!.statusVersion).toBe(5);
        });

        it('should not affect DRAFT bots', async () => {
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: validConfig,
                    status: 'DRAFT',
                    statusVersion: 0,
                },
            });

            await request(app)
                .post('/api/kill-switch/enable')
                .set('Authorization', `Bearer ${testToken}`)
                .send({});

            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.status).toBe('DRAFT');
            expect(afterBot!.statusVersion).toBe(0);
        });

        it('should not affect STOPPED bots', async () => {
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: validConfig,
                    status: 'STOPPED',
                    statusVersion: 10,
                },
            });

            await request(app)
                .post('/api/kill-switch/enable')
                .set('Authorization', `Bearer ${testToken}`)
                .send({});

            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.status).toBe('STOPPED');
            expect(afterBot!.statusVersion).toBe(10);
        });
    });

    describe('验收 4: 重复 enable/disable 幂等', () => {
        it('should be idempotent for multiple enable calls', async () => {
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: validConfig,
                    status: 'RUNNING',
                    statusVersion: 1,
                },
            });

            // 第一次 enable
            await request(app)
                .post('/api/kill-switch/enable')
                .set('Authorization', `Bearer ${testToken}`)
                .send({});

            // 第二次 enable（幂等）
            const res = await request(app)
                .post('/api/kill-switch/enable')
                .set('Authorization', `Bearer ${testToken}`)
                .send({});

            expect(res.status).toBe(200);
            // 第二次 affectedBots 应该为 0（bot 已经是 STOPPING 了）
            expect(res.body.affectedBots).toBe(0);

            // 验证 bot 只被更新一次
            const afterBot = await prisma.bot.findUnique({ where: { id: bot.id } });
            expect(afterBot!.statusVersion).toBe(2); // 只增加了 1 次
        });

        it('should be idempotent for multiple disable calls', async () => {
            // 先 enable
            await request(app)
                .post('/api/kill-switch/enable')
                .set('Authorization', `Bearer ${testToken}`)
                .send({});

            // 多次 disable
            await request(app)
                .post('/api/kill-switch/disable')
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            const res = await request(app)
                .post('/api/kill-switch/disable')
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            expect(res.status).toBe(200);
            expect(res.body.enabled).toBe(false);
        });
    });

    describe('验收 5: Disable 后恢复可 start', () => {
        it('should allow start after disable', async () => {
            const bot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'BNB/USDT',
                    configJson: validConfig,
                    status: 'DRAFT',
                    statusVersion: 0,
                },
            });

            // Enable
            await request(app)
                .post('/api/kill-switch/enable')
                .set('Authorization', `Bearer ${testToken}`)
                .send({});

            // Disable
            await request(app)
                .post('/api/kill-switch/disable')
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            // Start 应该成功
            const res = await request(app)
                .post(`/api/bots/${bot.id}/start`)
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            expect(res.status).toBe(200);
        });
    });

    describe('GET /kill-switch', () => {
        it('should return kill switch state', async () => {
            const res = await request(app)
                .get('/api/kill-switch')
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            expect(res.status).toBe(200);
            expect(typeof res.body.enabled).toBe('boolean');
        });
    });
});
