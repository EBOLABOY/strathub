/**
 * Exchange Accounts Routes
 * 
 * GET / - List user's exchange accounts (sanitized, no credentials)
 * POST / - Create new exchange account
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma, Prisma } from '@crypto-strategy-hub/database';
import { FEATURED_EXCHANGES, normalizeSupportedExchangeId, requiresPassphrase, supportsTestnet } from '@crypto-strategy-hub/shared';
import { createApiError } from '../middleware/error-handler.js';
import { authGuard, requireUserId } from '../middleware/auth-guard.js';
import { encryptCredentials, decryptCredentials, isEncryptedFormat, isEncryptionEnabled } from '@crypto-strategy-hub/security';
import { createCcxtExecutor } from '@crypto-strategy-hub/exchange';

export const accountsRouter = Router();

// All routes require authentication
accountsRouter.use(authGuard);

// Schemas
const createAccountSchema = z.object({
    name: z.string().min(1).max(100),
    exchange: z.enum(FEATURED_EXCHANGES),
    apiKey: z.string().min(1),
    secret: z.string().min(1),
    passphrase: z.string().min(1).optional(),
    isTestnet: z.boolean().optional().default(false),
});

const updateAccountSchema = z
    .object({
        name: z.string().min(1).max(100).optional(),
        apiKey: z.string().min(1).optional(),
        secret: z.string().min(1).optional(),
        passphrase: z.string().min(1).optional(),
        isTestnet: z.boolean().optional(),
    })
    .refine((data) => (data.apiKey === undefined) === (data.secret === undefined), {
        message: 'Both apiKey and secret are required',
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required',
    });

const accountIdParamSchema = z.object({
    accountId: z.string().uuid(),
});

// DTO - Never expose encryptedCredentials
interface AccountDTO {
    id: string;
    exchange: string;
    name: string;
    isTestnet: boolean;
    createdAt: Date;
}

function toAccountDTO(account: {
    id: string;
    exchange: string;
    name: string;
    isTestnet: boolean;
    createdAt: Date;
}): AccountDTO {
    return {
        id: account.id,
        exchange: account.exchange,
        name: account.name,
        isTestnet: account.isTestnet,
        createdAt: account.createdAt,
    };
}

type StoredCredentials = { apiKey: string; secret: string; passphrase?: string };

function parseStoredCredentials(raw: string): StoredCredentials {
    const json = isEncryptedFormat(raw) ? decryptCredentials(raw) : raw;
    return JSON.parse(json) as StoredCredentials;
}

// GET /api/accounts - List user's exchange accounts
accountsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = requireUserId(req);

        const accounts = await prisma.exchangeAccount.findMany({
            where: { userId },
            select: {
                id: true,
                exchange: true,
                name: true,
                isTestnet: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json(accounts.map(toAccountDTO));
    } catch (error) {
        next(error);
    }
});

// POST /api/accounts - Create new exchange account
accountsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = requireUserId(req);
        const { name, exchange: rawExchange, apiKey, secret, passphrase, isTestnet } = createAccountSchema.parse(req.body);

        const exchangeId = normalizeSupportedExchangeId(rawExchange);
        if (!exchangeId) {
            throw createApiError(`Exchange not supported: ${rawExchange}`, 400, 'EXCHANGE_NOT_SUPPORTED');
        }
        if (isTestnet && !supportsTestnet(exchangeId)) {
            throw createApiError('Testnet is not supported for this exchange', 400, 'TESTNET_NOT_SUPPORTED');
        }
        if (requiresPassphrase(exchangeId) && !passphrase) {
            throw createApiError('Passphrase is required for this exchange', 400, 'MISSING_PASSPHRASE');
        }

        // M3B: Allow mainnet accounts only when encryption is enabled
        // This ensures credentials are never stored as plaintext for real keys
        if (!isTestnet && !isEncryptionEnabled()) {
            throw createApiError(
                'Mainnet accounts require encryption. Set CREDENTIALS_ENCRYPTION_KEY.',
                403,
                'MAINNET_ACCOUNT_FORBIDDEN'
            );
        }

        // Encrypt credentials if encryption key is available
        // Otherwise store as plaintext JSON (for testnet backward compat)
        const credentialsJson = JSON.stringify({ apiKey, secret, ...(passphrase ? { passphrase } : {}) });
        let encryptedCredentials: string;

        if (isEncryptionEnabled()) {
            encryptedCredentials = encryptCredentials(credentialsJson);
        } else {
            // Warn: storing unencrypted (testnet only)
            console.warn('[SECURITY] Credentials stored unencrypted - CREDENTIALS_ENCRYPTION_KEY not set');
            encryptedCredentials = credentialsJson;
        }

        const account = await prisma.exchangeAccount.create({
            data: {
                userId,
                name,
                exchange: exchangeId,
                isTestnet,
                encryptedCredentials,
            },
            select: {
                id: true,
                exchange: true,
                name: true,
                isTestnet: true,
                createdAt: true,
            },
        });

        res.status(201).json(toAccountDTO(account));
    } catch (error) {
        // Handle unique constraint violation
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2002') {
                // Unique constraint failed on (userId, exchange, name)
                next(createApiError(
                    'Exchange account with this name already exists for this exchange',
                    409,
                    'EXCHANGE_ACCOUNT_ALREADY_EXISTS'
                ));
                return;
            }
        }
        next(error);
    }
});

// PUT /api/accounts/:accountId - Update exchange account (no credentials returned)
accountsRouter.put('/:accountId', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = requireUserId(req);
        const { accountId } = accountIdParamSchema.parse(req.params);
        const { name, apiKey, secret, passphrase, isTestnet } = updateAccountSchema.parse(req.body);

        const account = await prisma.exchangeAccount.findFirst({
            where: { id: accountId, userId },
            select: {
                id: true,
                exchange: true,
                name: true,
                isTestnet: true,
                encryptedCredentials: true,
                createdAt: true,
            },
        });

        if (!account) {
            throw createApiError('Account not found', 404, 'EXCHANGE_ACCOUNT_NOT_FOUND');
        }

        const exchangeId = normalizeSupportedExchangeId(account.exchange);
        if (!exchangeId) {
            throw createApiError(`Exchange not supported: ${account.exchange}`, 400, 'EXCHANGE_NOT_SUPPORTED');
        }

        const nextIsTestnet = isTestnet ?? account.isTestnet;
        const isSwitchingToMainnet = isTestnet === false && account.isTestnet !== false;
        const updatingApiKeySecret = apiKey !== undefined && secret !== undefined;
        const updatingPassphrase = passphrase !== undefined;
        const updatingCredentials = updatingApiKeySecret || updatingPassphrase;

        if (isTestnet === true && !supportsTestnet(exchangeId)) {
            throw createApiError('Testnet is not supported for this exchange', 400, 'TESTNET_NOT_SUPPORTED');
        }

        // Security: never allow storing mainnet credentials unencrypted.
        // - Switching from testnet -> mainnet requires encryption enabled.
        // - Updating credentials on a mainnet account requires encryption enabled.
        if (!nextIsTestnet && !isEncryptionEnabled() && (isSwitchingToMainnet || updatingCredentials)) {
            throw createApiError(
                'Mainnet accounts require encryption. Set CREDENTIALS_ENCRYPTION_KEY.',
                403,
                'MAINNET_ACCOUNT_FORBIDDEN'
            );
        }

        let encryptedCredentials: string | undefined;
        if (updatingCredentials) {
            let current: StoredCredentials;
            try {
                current = parseStoredCredentials(account.encryptedCredentials);
            } catch {
                throw createApiError('Invalid credentials', 500, 'INVALID_CREDENTIALS');
            }

            const nextCredentials: StoredCredentials = {
                apiKey: updatingApiKeySecret ? apiKey! : current.apiKey,
                secret: updatingApiKeySecret ? secret! : current.secret,
                passphrase: updatingPassphrase ? passphrase : current.passphrase,
            };

            if (requiresPassphrase(exchangeId) && !nextCredentials.passphrase) {
                throw createApiError('Passphrase is required for this exchange', 400, 'MISSING_PASSPHRASE');
            }

            const credentialsJson = JSON.stringify(nextCredentials);
            if (isEncryptionEnabled()) {
                encryptedCredentials = encryptCredentials(credentialsJson);
            } else {
                console.warn('[SECURITY] Credentials stored unencrypted - CREDENTIALS_ENCRYPTION_KEY not set');
                encryptedCredentials = credentialsJson;
            }
        }

        const updated = await prisma.exchangeAccount.update({
            where: { id: accountId },
            data: {
                ...(name !== undefined ? { name } : {}),
                ...(isTestnet !== undefined ? { isTestnet } : {}),
                ...(encryptedCredentials !== undefined ? { encryptedCredentials } : {}),
            },
            select: {
                id: true,
                exchange: true,
                name: true,
                isTestnet: true,
                createdAt: true,
            },
        });

        res.json(toAccountDTO(updated));
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2002') {
                next(createApiError(
                    'Exchange account with this name already exists for this exchange',
                    409,
                    'EXCHANGE_ACCOUNT_ALREADY_EXISTS'
                ));
                return;
            }
        }
        next(error);
    }
});

// DELETE /api/accounts/:accountId - Delete exchange account
accountsRouter.delete('/:accountId', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = requireUserId(req);
        const { accountId } = accountIdParamSchema.parse(req.params);

        // Validate account exists and belongs to user
        const account = await prisma.exchangeAccount.findFirst({
            where: { id: accountId, userId },
        });

        if (!account) {
            throw createApiError('Account not found', 404, 'EXCHANGE_ACCOUNT_NOT_FOUND');
        }

        // Check for existing bots - prevent cascade deletion disaster
        const botCount = await prisma.bot.count({
            where: { exchangeAccountId: accountId },
        });

        if (botCount > 0) {
            throw createApiError(
                `Cannot delete account with ${botCount} active bot(s). Delete bots first.`,
                409,
                'ACCOUNT_HAS_BOTS'
            );
        }

        // Safe to delete
        await prisma.exchangeAccount.delete({
            where: { id: accountId },
        });

        res.status(204).send();
    } catch (error) {
        next(error);
    }
});

// GET /api/accounts/:accountId/balance - Get account balance
accountsRouter.get('/:accountId/balance', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = requireUserId(req);
        const { accountId } = accountIdParamSchema.parse(req.params);

        const account = await prisma.exchangeAccount.findFirst({
            where: { id: accountId, userId },
        });

        if (!account) {
            throw createApiError('Account not found', 404, 'EXCHANGE_ACCOUNT_NOT_FOUND');
        }

        const exchangeId = normalizeSupportedExchangeId(account.exchange);
        if (!exchangeId) {
            throw createApiError(`Exchange not supported: ${account.exchange}`, 400, 'EXCHANGE_NOT_SUPPORTED');
        }
        if (account.isTestnet && !supportsTestnet(exchangeId)) {
            throw createApiError('Testnet is not supported for this exchange', 400, 'TESTNET_NOT_SUPPORTED');
        }

        if (!account.isTestnet && process.env['ALLOW_MAINNET_TRADING'] !== 'true') {
            throw createApiError(
                'Mainnet access is disabled. Set ALLOW_MAINNET_TRADING=true to enable.',
                403,
                'MAINNET_TRADING_DISABLED'
            );
        }

        let creds: StoredCredentials;
        try {
            creds = parseStoredCredentials(account.encryptedCredentials);
        } catch {
            throw createApiError('Invalid credentials', 500, 'INVALID_CREDENTIALS');
        }

        if (!creds.apiKey || !creds.secret) {
            throw createApiError('Invalid credentials', 500, 'INVALID_CREDENTIALS');
        }

        if (requiresPassphrase(exchangeId) && !creds.passphrase) {
            throw createApiError('Passphrase is required for this exchange', 400, 'MISSING_PASSPHRASE');
        }

        const allowMainnet = process.env['ALLOW_MAINNET_TRADING'] === 'true';

        const executor = createCcxtExecutor({
            exchangeId,
            apiKey: creds.apiKey,
            secret: creds.secret,
            passphrase: creds.passphrase,
            isTestnet: account.isTestnet,
            allowMainnet,
        });

        const balance = await executor.fetchBalance();
        res.json(balance);
    } catch (error) {
        next(error);
    }
});
