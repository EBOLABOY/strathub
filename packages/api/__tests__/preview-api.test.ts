/**
 * ACC-API-001: Preview API 级别测试
 * 
 * 测试：
 * - configOverride 不落库
 * - ERROR 阻止 start
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { prisma } from '@crypto-strategy-hub/database';
import jwt from 'jsonwebtoken';

// 模拟 app（不启动真实服务器）
const createTestApp = async () => {
    const { botsRouter } = await import('../src/routes/bots.js');
    const { authRouter } = await import('../src/routes/auth.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');

    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    app.use('/api/bots', botsRouter);
    app.use(errorHandler);

    return app;
};

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production';

// 创建测试 JWT
function createTestToken(userId: string): string {
    return jwt.sign({ userId, email: 'test@test.com', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });
}

describe('ACC-API-001: Preview API HTTP Tests', () => {
    let app: express.Express;
    let testUserId: string;
    let testToken: string;
    let testBotId: string;
    let testExchangeAccountId: string;

    beforeAll(async () => {
        app = await createTestApp();

        // 创建测试用户（直接在数据库）
        const user = await prisma.user.create({
            data: {
                email: `test-${Date.now()}@test.com`,
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
                name: 'test-account',
                encryptedCredentials: '{}',
            },
        });
        testExchangeAccountId = exchangeAccount.id;

        // 创建测试 Bot（有效配置）
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
                exchangeAccountId: testExchangeAccountId,
                symbol: 'BNB/USDT',
                configJson: validConfig,
                status: 'DRAFT',
            },
        });
        testBotId = bot.id;
    });

    afterEach(async () => {
        // 恢复 bot 状态
        try {
            await prisma.bot.update({
                where: { id: testBotId },
                data: { status: 'DRAFT', statusVersion: 0 },
            });
        } catch {
            // 可能 bot 已被删除
        }
    });

    describe('POST /api/bots/:botId/preview', () => {
        it('should return preview result with valid config', async () => {
            const res = await request(app)
                .post(`/api/bots/${testBotId}/preview`)
                .set('Authorization', `Bearer ${testToken}`)
                .send({});

            expect(res.status).toBe(200);
            expect(res.body.basePrice).toBeDefined();
            expect(res.body.buyTriggerPrice).toBeDefined();
            expect(res.body.sellTriggerPrice).toBeDefined();
            expect(res.body.lines).toBeInstanceOf(Array);
            expect(res.body.orders).toBeInstanceOf(Array);
        });

        it('should support configOverride without modifying database', async () => {
            const originalBot = await prisma.bot.findUnique({ where: { id: testBotId } });
            const originalConfigRevision = originalBot!.configRevision;

            const res = await request(app)
                .post(`/api/bots/${testBotId}/preview`)
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    configOverride: {
                        trigger: {
                            basePriceType: 'manual',
                            basePrice: '600.00',
                        },
                    },
                });

            expect(res.status).toBe(200);
            // 使用了 override 的 basePrice
            expect(res.body.basePrice).toBe('600.00');

            // 数据库没有变化
            const afterBot = await prisma.bot.findUnique({ where: { id: testBotId } });
            expect(afterBot!.configRevision).toBe(originalConfigRevision);
        });

        it('should return ERROR for basePriceType=cost in configOverride', async () => {
            const res = await request(app)
                .post(`/api/bots/${testBotId}/preview`)
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    configOverride: {
                        trigger: {
                            basePriceType: 'cost',
                        },
                    },
                });

            expect(res.status).toBe(200);
            expect(res.body.issues).toBeInstanceOf(Array);
            const costError = res.body.issues.find(
                (i: { code: string }) => i.code === 'UNSUPPORTED_BASE_PRICE_TYPE'
            );
            expect(costError).toBeDefined();
            expect(costError.severity).toBe('ERROR');
        });

        it('should return 401 without auth', async () => {
            const res = await request(app)
                .post(`/api/bots/${testBotId}/preview`)
                .send({});

            expect(res.status).toBe(401);
        });
    });

    describe('POST /api/bots/:botId/start - 校验阻断', () => {
        it('should start successfully with valid config (enters WAITING_TRIGGER when has trigger)', async () => {
            const res = await request(app)
                .post(`/api/bots/${testBotId}/start`)
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            expect(res.status).toBe(200);
            // 配置有 riseSell/fallBuy，所以 hasTriggerCondition=true → WAITING_TRIGGER
            expect(res.body.status).toBe('WAITING_TRIGGER');
        });

        it('should return 422 and not change status when config has ERROR', async () => {
            // 创建一个有错误的 Bot
            const badConfig = JSON.stringify({
                trigger: {
                    gridType: 'percent',
                    basePriceType: 'cost', // V1 不支持
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

            const badBot = await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: testExchangeAccountId,
                    symbol: 'ETH/USDT',
                    configJson: badConfig,
                    status: 'DRAFT',
                    statusVersion: 0,
                },
            });

            const res = await request(app)
                .post(`/api/bots/${badBot.id}/start`)
                .set('Authorization', `Bearer ${testToken}`)
                .send();

            expect(res.status).toBe(422);
            expect(res.body.code).toBe('CONFIG_VALIDATION_ERROR');

            // 验证状态没有改变
            const afterBot = await prisma.bot.findUnique({ where: { id: badBot.id } });
            expect(afterBot!.status).toBe('DRAFT');
            expect(afterBot!.statusVersion).toBe(0);

            // 清理
            await prisma.bot.delete({ where: { id: badBot.id } });
        });
    });
});
