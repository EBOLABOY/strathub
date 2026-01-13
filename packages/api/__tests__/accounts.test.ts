/**
 * Accounts API HTTP Tests
 * 
 * 验证：
 * 1. GET /api/accounts: 返回脱敏 DTO，绝不回传 credentials
 * 2. POST /api/accounts: 重复创建返回 409, mainnet 需要加密
 * 3. DELETE /api/accounts: 成功删除, 有 bot 返回 409
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '@crypto-strategy-hub/database';
import { randomBytes } from 'crypto';

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production';

function createTestToken(userId: string): string {
    return jwt.sign({ userId, email: 'test@test.com', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });
}

async function createTestApp() {
    const { accountsRouter } = await import('../src/routes/accounts.js');
    const { errorHandler } = await import('../src/middleware/error-handler.js');

    const app = express();
    app.use(express.json());
    app.use('/api/accounts', accountsRouter);
    app.use(errorHandler);

    return app;
}

describe('Accounts API', () => {
    let testUserId: string;
    let testToken: string;

    beforeAll(async () => {
        const user = await prisma.user.create({
            data: {
                email: `test-accounts-${Date.now()}@test.com`,
                passwordHash: 'test-hash',
            },
        });
        testUserId = user.id;
        testToken = createTestToken(testUserId);
    });

    afterAll(async () => {
        await prisma.bot.deleteMany({ where: { userId: testUserId } });
        await prisma.exchangeAccount.deleteMany({ where: { userId: testUserId } });
        await prisma.user.delete({ where: { id: testUserId } });
    });

    describe('GET /api/accounts', () => {
        it('should return sanitized DTO without credentials', async () => {
            const app = await createTestApp();

            // First create an account with real credentials
            await prisma.exchangeAccount.create({
                data: {
                    userId: testUserId,
                    exchange: 'binance',
                    name: `test-noleak-${Date.now()}`,
                    encryptedCredentials: JSON.stringify({ apiKey: 'SECRET_KEY', secret: 'SECRET_SECRET' }),
                },
            });

            const res = await request(app)
                .get('/api/accounts')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBeGreaterThan(0);

            // Critical: Verify NO credentials leak
            const account = res.body[0];
            expect(account.id).toBeDefined();
            expect(account.exchange).toBeDefined();
            expect(account.name).toBeDefined();

            // These MUST be absent
            expect(account.encryptedCredentials).toBeUndefined();
            expect(account.apiKey).toBeUndefined();
            expect(account.secret).toBeUndefined();
        });
    });

    describe('POST /api/accounts', () => {
        it('should encrypt credentials when CREDENTIALS_ENCRYPTION_KEY is set (testnet)', async () => {
            const originalKey = process.env['CREDENTIALS_ENCRYPTION_KEY'];
            process.env['CREDENTIALS_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');

            try {
                const app = await createTestApp();

                const res = await request(app)
                    .post('/api/accounts')
                    .set('Authorization', `Bearer ${testToken}`)
                    .send({
                        name: `encrypted-test-${Date.now()}`,
                        exchange: 'binance',
                        apiKey: 'mock-key',
                        secret: 'mock-secret',
                        isTestnet: true,
                    });

                expect(res.status).toBe(201);
                expect(res.body.id).toBeDefined();

                const created = await prisma.exchangeAccount.findUnique({
                    where: { id: res.body.id },
                    select: { encryptedCredentials: true },
                });

                expect(created).toBeTruthy();
                expect(created!.encryptedCredentials.split(':')).toHaveLength(3);
                expect(() => JSON.parse(created!.encryptedCredentials)).toThrow();
            } finally {
                if (originalKey) {
                    process.env['CREDENTIALS_ENCRYPTION_KEY'] = originalKey;
                } else {
                    delete process.env['CREDENTIALS_ENCRYPTION_KEY'];
                }
            }
        });

        it('should return 409 EXCHANGE_ACCOUNT_ALREADY_EXISTS for duplicate', async () => {
            const app = await createTestApp();
            const uniqueName = `duplicate-test-${Date.now()}`;

            const accountData = {
                name: uniqueName,
                exchange: 'binance',
                apiKey: 'mock-key',
                secret: 'mock-secret',
                isTestnet: true,
            };

            // First create
            const res1 = await request(app)
                .post('/api/accounts')
                .set('Authorization', `Bearer ${testToken}`)
                .send(accountData);

            expect(res1.status).toBe(201);

            // Duplicate create should fail
            const res2 = await request(app)
                .post('/api/accounts')
                .set('Authorization', `Bearer ${testToken}`)
                .send(accountData);

            expect(res2.status).toBe(409);
            expect(res2.body.code).toBe('EXCHANGE_ACCOUNT_ALREADY_EXISTS');
        });

        it('should return 403 MAINNET_ACCOUNT_FORBIDDEN when no encryption key', async () => {
            const originalKey = process.env['CREDENTIALS_ENCRYPTION_KEY'];
            delete process.env['CREDENTIALS_ENCRYPTION_KEY'];

            try {
                const app = await createTestApp();

                const res = await request(app)
                    .post('/api/accounts')
                    .set('Authorization', `Bearer ${testToken}`)
                    .send({
                        name: `mainnet-no-key-${Date.now()}`,
                        exchange: 'binance',
                        apiKey: 'mock-key',
                        secret: 'mock-secret',
                        isTestnet: false, // mainnet
                    });

                expect(res.status).toBe(403);
                expect(res.body.code).toBe('MAINNET_ACCOUNT_FORBIDDEN');
            } finally {
                if (originalKey) {
                    process.env['CREDENTIALS_ENCRYPTION_KEY'] = originalKey;
                }
            }
        });

        it('should allow mainnet account creation when encryption key is set', async () => {
            const originalKey = process.env['CREDENTIALS_ENCRYPTION_KEY'];
            process.env['CREDENTIALS_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');

            try {
                const app = await createTestApp();

                const res = await request(app)
                    .post('/api/accounts')
                    .set('Authorization', `Bearer ${testToken}`)
                    .send({
                        name: `mainnet-allowed-${Date.now()}`,
                        exchange: 'binance',
                        apiKey: 'real-mainnet-key',
                        secret: 'real-mainnet-secret',
                        isTestnet: false, // mainnet - should work!
                    });

                expect(res.status).toBe(201);
                expect(res.body.id).toBeDefined();
                expect(res.body.isTestnet).toBe(false);

                // Verify stored as encrypted
                const created = await prisma.exchangeAccount.findUnique({
                    where: { id: res.body.id },
                    select: { encryptedCredentials: true },
                });
                expect(created!.encryptedCredentials.split(':')).toHaveLength(3);
            } finally {
                if (originalKey) {
                    process.env['CREDENTIALS_ENCRYPTION_KEY'] = originalKey;
                } else {
                    delete process.env['CREDENTIALS_ENCRYPTION_KEY'];
                }
            }
        });
    });

    describe('PUT /api/accounts/:accountId', () => {
        it('should update account name successfully', async () => {
            const app = await createTestApp();

            const account = await prisma.exchangeAccount.create({
                data: {
                    userId: testUserId,
                    exchange: 'binance',
                    name: `update-me-${Date.now()}`,
                    encryptedCredentials: '{}',
                    isTestnet: true,
                },
            });

            const res = await request(app)
                .put(`/api/accounts/${account.id}`)
                .set('Authorization', `Bearer ${testToken}`)
                .send({ name: `updated-${Date.now()}` });

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(account.id);
            expect(res.body.name).toMatch(/^updated-/);

            const updated = await prisma.exchangeAccount.findUnique({
                where: { id: account.id },
                select: { name: true },
            });
            expect(updated?.name).toBe(res.body.name);
        });

        it('should return 403 MAINNET_ACCOUNT_FORBIDDEN when switching to mainnet without encryption key', async () => {
            const originalKey = process.env['CREDENTIALS_ENCRYPTION_KEY'];
            delete process.env['CREDENTIALS_ENCRYPTION_KEY'];

            try {
                const app = await createTestApp();

                const account = await prisma.exchangeAccount.create({
                    data: {
                        userId: testUserId,
                        exchange: 'binance',
                        name: `switch-mainnet-${Date.now()}`,
                        encryptedCredentials: '{}',
                        isTestnet: true,
                    },
                });

                const res = await request(app)
                    .put(`/api/accounts/${account.id}`)
                    .set('Authorization', `Bearer ${testToken}`)
                    .send({ isTestnet: false });

                expect(res.status).toBe(403);
                expect(res.body.code).toBe('MAINNET_ACCOUNT_FORBIDDEN');
            } finally {
                if (originalKey) {
                    process.env['CREDENTIALS_ENCRYPTION_KEY'] = originalKey;
                } else {
                    delete process.env['CREDENTIALS_ENCRYPTION_KEY'];
                }
            }
        });
    });

    describe('DELETE /api/accounts/:accountId', () => {
        it('should delete account successfully when no bots exist', async () => {
            const app = await createTestApp();

            // Create account to delete
            const account = await prisma.exchangeAccount.create({
                data: {
                    userId: testUserId,
                    exchange: 'okx',
                    name: `delete-me-${Date.now()}`,
                    encryptedCredentials: '{}',
                    isTestnet: true,
                },
            });

            const res = await request(app)
                .delete(`/api/accounts/${account.id}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(204);

            // Verify deleted
            const deleted = await prisma.exchangeAccount.findUnique({
                where: { id: account.id },
            });
            expect(deleted).toBeNull();
        });

        it('should return 409 ACCOUNT_HAS_BOTS when account has bots', async () => {
            const app = await createTestApp();

            // Create account
            const account = await prisma.exchangeAccount.create({
                data: {
                    userId: testUserId,
                    exchange: 'binance',
                    name: `has-bots-${Date.now()}`,
                    encryptedCredentials: '{}',
                    isTestnet: true,
                },
            });

            // Create bot for this account
            await prisma.bot.create({
                data: {
                    userId: testUserId,
                    exchangeAccountId: account.id,
                    symbol: 'TEST/USDT',
                    configJson: '{}',
                },
            });

            const res = await request(app)
                .delete(`/api/accounts/${account.id}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('ACCOUNT_HAS_BOTS');

            // Cleanup
            await prisma.bot.deleteMany({ where: { exchangeAccountId: account.id } });
            await prisma.exchangeAccount.delete({ where: { id: account.id } });
        });
    });
});
