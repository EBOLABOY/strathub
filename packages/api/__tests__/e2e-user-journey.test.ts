/**
 * E2E API 验证测试
 * 
 * 验证核心 API 路由的正确性
 * 
 * 注意：Bot 生命周期操作（start/stop/pause/resume）需要 worker 和 provider，
 * 这部分测试在 worker 包的集成测试中覆盖
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
    const { botsRouter } = await import('../src/routes/bots.js');
    const { accountsRouter } = await import('../src/routes/accounts.js');
    const { configRouter } = await import('../src/routes/config.js');
    const { templatesRouter } = await import('../src/routes/templates.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');

    const app = express();
    app.use(express.json());
    app.use('/api/bots', botsRouter);
    app.use('/api/accounts', accountsRouter);
    app.use('/api/config', configRouter);
    app.use('/api/templates', templatesRouter);
    app.use(errorHandler);

    return app;
}

describe('E2E API - CRUD Operations', () => {
    let testUserId: string;
    let testToken: string;
    let accountId: string;
    let botId: string;

    beforeAll(async () => {
        const user = await prisma.user.create({
            data: {
                email: `e2e-crud-${Date.now()}@test.com`,
                passwordHash: 'test-hash',
            },
        });
        testUserId = user.id;
        testToken = createTestToken(testUserId);
    });

    afterAll(async () => {
        // Cleanup
        if (botId) {
            try {
                await prisma.bot.delete({ where: { id: botId } });
            } catch { /* ignore */ }
        }
        if (accountId) {
            try {
                await prisma.exchangeAccount.delete({ where: { id: accountId } });
            } catch { /* ignore */ }
        }
        try {
            await prisma.user.delete({ where: { id: testUserId } });
        } catch { /* ignore */ }
    });

    describe('Exchange Accounts CRUD', () => {
        it('should create a testnet exchange account', async () => {
            const app = await createTestApp();

            const res = await request(app)
                .post('/api/accounts')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    name: 'E2E Test Account',
                    exchange: 'binance',
                    apiKey: 'test-api-key',
                    secret: 'test-secret',
                    isTestnet: true,
                });

            expect(res.status).toBe(201);
            expect(res.body).toHaveProperty('id');
            expect(res.body.name).toBe('E2E Test Account');
            expect(res.body.isTestnet).toBe(true);
            // Credentials should not be exposed
            expect(res.body.encryptedCredentials).toBeUndefined();

            accountId = res.body.id;
        });

        it('should list exchange accounts without credentials', async () => {
            const app = await createTestApp();

            const res = await request(app)
                .get('/api/accounts')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBeGreaterThan(0);

            const account = res.body.find((a: any) => a.id === accountId);
            expect(account).toBeDefined();
            expect(account.encryptedCredentials).toBeUndefined();
            expect(account.apiKey).toBeUndefined();
            expect(account.secret).toBeUndefined();
        });
    });

    describe('Bot CRUD', () => {
        it('should create a bot in DRAFT status', async () => {
            const app = await createTestApp();

            const config = {
                trigger: {
                    basePriceType: 'current',
                    sellPercent: '2',
                    buyPercent: '2',
                },
                trade: {
                    quoteAmount: '100',
                },
                order: {
                    orderType: 'limit',
                },
                risk: {
                    enableAutoClose: false,
                },
            };

            const res = await request(app)
                .post('/api/bots')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    exchangeAccountId: accountId,
                    symbol: 'BNB/USDT',
                    configJson: JSON.stringify(config),
                });

            expect(res.status).toBe(201);
            expect(res.body).toHaveProperty('id');
            expect(res.body.status).toBe('DRAFT');
            expect(res.body.symbol).toBe('BNB/USDT');

            botId = res.body.id;
        });

        it('should get bot details', async () => {
            const app = await createTestApp();

            const res = await request(app)
                .get(`/api/bots/${botId}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(botId);
            expect(res.body.status).toBe('DRAFT');
            expect(res.body.symbol).toBe('BNB/USDT');
        });

        it('should list bots', async () => {
            const app = await createTestApp();

            const res = await request(app)
                .get('/api/bots')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.some((b: any) => b.id === botId)).toBe(true);
        });

        it('should update bot config', async () => {
            const app = await createTestApp();

            const newConfig = {
                trigger: {
                    basePriceType: 'current',
                    sellPercent: '3',
                    buyPercent: '3',
                },
                trade: {
                    quoteAmount: '200',
                },
                order: {
                    orderType: 'limit',
                },
                risk: {
                    enableAutoClose: false,
                },
            };

            const res = await request(app)
                .put(`/api/bots/${botId}/config`)
                .set('Authorization', `Bearer ${testToken}`)
                .send({ configJson: JSON.stringify(newConfig) });

            expect(res.status).toBe(200);
            expect(res.body.configRevision).toBeGreaterThan(0);
        });

        it('should delete bot in DRAFT status', async () => {
            const app = await createTestApp();

            await request(app)
                .delete(`/api/bots/${botId}`)
                .set('Authorization', `Bearer ${testToken}`)
                .expect(204);

            // Verify deleted
            const deleted = await prisma.bot.findUnique({ where: { id: botId } });
            expect(deleted).toBeNull();

            botId = '';
        });
    });
});

describe('E2E API - Config & Templates', () => {
    let testUserId: string;
    let testToken: string;
    let templateId: string;

    beforeAll(async () => {
        const user = await prisma.user.create({
            data: {
                email: `e2e-config-${Date.now()}@test.com`,
                passwordHash: 'test-hash',
            },
        });
        testUserId = user.id;
        testToken = createTestToken(testUserId);
    });

    afterAll(async () => {
        // Cleanup
        await prisma.configHistory.deleteMany({
            where: { configItem: { key: { startsWith: 'E2E_' } } },
        });
        await prisma.configItem.deleteMany({
            where: { key: { startsWith: 'E2E_' } },
        });
        if (templateId) {
            try {
                await prisma.configTemplate.delete({ where: { id: templateId } });
            } catch { /* ignore */ }
        }
        try {
            await prisma.user.delete({ where: { id: testUserId } });
        } catch { /* ignore */ }
    });

    describe('Config CRUD', () => {
        it('should import configs', async () => {
            const app = await createTestApp();

            const res = await request(app)
                .post('/api/config/import')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    configs: [
                        { key: 'E2E_CONFIG_1', value: 'value1', description: 'Test config' },
                        { key: 'E2E_CONFIG_2', value: 'value2' },
                    ],
                });

            expect(res.status).toBe(200);
            expect(res.body.imported).toBe(2);
        });

        it('should list configs', async () => {
            const app = await createTestApp();

            const res = await request(app)
                .get('/api/config')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.some((c: any) => c.key === 'E2E_CONFIG_1')).toBe(true);
        });

        it('should get single config', async () => {
            const app = await createTestApp();

            const res = await request(app)
                .get('/api/config/E2E_CONFIG_1')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.key).toBe('E2E_CONFIG_1');
            expect(res.body.value).toBe('value1');
        });

        it('should update config and create history', async () => {
            const app = await createTestApp();

            const res = await request(app)
                .put('/api/config/E2E_CONFIG_1')
                .set('Authorization', `Bearer ${testToken}`)
                .send({ value: 'updated_value' });

            expect(res.status).toBe(200);
            expect(res.body.value).toBe('updated_value');
        });

        it('should retrieve config history', async () => {
            const app = await createTestApp();

            const res = await request(app)
                .get('/api/config/E2E_CONFIG_1/history')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBeGreaterThan(0);
        });

        it('should export configs', async () => {
            const app = await createTestApp();

            const res = await request(app)
                .get('/api/config/export')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('configs');
            expect(Array.isArray(res.body.configs)).toBe(true);
        });
    });

    describe('Templates CRUD', () => {
        it('should create a template', async () => {
            const app = await createTestApp();

            const res = await request(app)
                .post('/api/templates')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    name: `E2E Template ${Date.now()}`,
                    description: 'E2E test template',
                    configJson: JSON.stringify({
                        trigger: { basePriceType: 'current', sellPercent: '3', buyPercent: '3' },
                    }),
                });

            expect(res.status).toBe(201);
            expect(res.body).toHaveProperty('id');
            templateId = res.body.id;
        });

        it('should list templates', async () => {
            const app = await createTestApp();

            const res = await request(app)
                .get('/api/templates')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.some((t: any) => t.id === templateId)).toBe(true);
        });

        it('should get template details', async () => {
            const app = await createTestApp();

            const res = await request(app)
                .get(`/api/templates/${templateId}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(templateId);
        });

        it('should update template', async () => {
            const app = await createTestApp();

            const res = await request(app)
                .put(`/api/templates/${templateId}`)
                .set('Authorization', `Bearer ${testToken}`)
                .send({ description: 'Updated' });

            expect(res.status).toBe(200);
            expect(res.body.description).toBe('Updated');
        });

        it('should delete template', async () => {
            const app = await createTestApp();

            await request(app)
                .delete(`/api/templates/${templateId}`)
                .set('Authorization', `Bearer ${testToken}`)
                .expect(204);

            templateId = '';
        });
    });
});
