/**
 * Exchange Accounts Routes
 * 
 * GET / - List user's exchange accounts (sanitized, no credentials)
 * POST / - Create new exchange account
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma, Prisma } from '@crypto-strategy-hub/database';
import { createApiError } from '../middleware/error-handler.js';
import { authGuard, requireUserId } from '../middleware/auth-guard.js';
import { encryptCredentials, decryptCredentials, isEncryptionEnabled } from '@crypto-strategy-hub/security';
import { createBinanceExecutor } from '@crypto-strategy-hub/exchange';

export const accountsRouter = Router();

// All routes require authentication
accountsRouter.use(authGuard);

// Schemas
const createAccountSchema = z.object({
    name: z.string().min(1).max(100),
    exchange: z.enum(['binance', 'okx']),
    apiKey: z.string().min(1),
    secret: z.string().min(1),
    isTestnet: z.boolean().optional().default(false),
});

const updateAccountSchema = z
    .object({
        name: z.string().min(1).max(100).optional(),
        apiKey: z.string().min(1).optional(),
        secret: z.string().min(1).optional(),
        isTestnet: z.boolean().optional(),
    })
    .refine((data) => (data.apiKey === undefined) === (data.secret === undefined), {
        message: 'Both apiKey and secret are required',
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required',
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
        const { name, exchange, apiKey, secret, isTestnet } = createAccountSchema.parse(req.body);

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
        const credentialsJson = JSON.stringify({ apiKey, secret });
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
                exchange,
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
        const { accountId } = req.params;
        const { name, apiKey, secret, isTestnet } = updateAccountSchema.parse(req.body);

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

        const nextIsTestnet = isTestnet ?? account.isTestnet;
        const isSwitchingToMainnet = isTestnet === false && account.isTestnet !== false;
        const updatingCredentials = apiKey !== undefined && secret !== undefined;

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
            const credentialsJson = JSON.stringify({ apiKey, secret });
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
        const { accountId } = req.params;

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
        const { accountId } = req.params;

        const account = await prisma.exchangeAccount.findFirst({
            where: { id: accountId, userId },
        });

        if (!account) {
            throw createApiError('Account not found', 404, 'EXCHANGE_ACCOUNT_NOT_FOUND');
        }

        let apiKey = '';
        let secret = '';

        if (account.encryptedCredentials) {
            try {
                const plain = JSON.parse(account.encryptedCredentials);
                apiKey = plain.apiKey;
                secret = plain.secret;
            } catch {
                const json = decryptCredentials(account.encryptedCredentials);
                const creds = JSON.parse(json);
                apiKey = creds.apiKey;
                secret = creds.secret;
            }
        }

        if (!apiKey || !secret) {
            throw createApiError('Invalid credentials', 500, 'INVALID_CREDENTIALS');
        }

        const executor = createBinanceExecutor({
            apiKey,
            secret,
            isTestnet: account.isTestnet,
            allowMainnet: !account.isTestnet
        });

        const balance = await executor.fetchBalance();
        res.json(balance);
    } catch (error) {
        next(error);
    }
});
