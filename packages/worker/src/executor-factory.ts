/**
 * TradingExecutor Factory
 * 
 * 按 exchangeAccountId 缓存 executor
 * 支持 Simulator 和 Real Exchange 两种模式
 */

import { ExchangeSimulator } from '@crypto-strategy-hub/exchange-simulator';
import type { TradingExecutor } from '@crypto-strategy-hub/shared';
import { createSimulatorExecutor } from './simulator-executor.js';
import { createBinanceExecutor } from '@crypto-strategy-hub/exchange';
import { PrismaClient } from '@crypto-strategy-hub/database';
import { decryptCredentials, isEncryptedFormat } from '@crypto-strategy-hub/security';

// ============================================================================
// Factory Types
// ============================================================================

export interface ExecutorContext {
    executor: TradingExecutor;
    simulator?: ExchangeSimulator; // Only available in simulator mode
}

export type ExecutorFactory = (exchangeAccountId: string) => Promise<ExecutorContext>;

// ============================================================================
// Simulator Factory（测试用）
// ============================================================================

export function createSimulatorFactory(): ExecutorFactory {
    const cache = new Map<string, ExecutorContext>();

    return async (exchangeAccountId: string): Promise<ExecutorContext> => {
        let context = cache.get(exchangeAccountId);
        if (!context) {
            const simulator = new ExchangeSimulator();
            const executor = createSimulatorExecutor(simulator);
            context = { simulator, executor };
            cache.set(exchangeAccountId, context);
        }
        return context;
    };
}

export function createSeededSimulatorFactory(
    seedFn: (simulator: ExchangeSimulator, exchangeAccountId: string) => void
): ExecutorFactory {
    const cache = new Map<string, ExecutorContext>();

    return async (exchangeAccountId: string): Promise<ExecutorContext> => {
        let context = cache.get(exchangeAccountId);
        if (!context) {
            const simulator = new ExchangeSimulator();
            seedFn(simulator, exchangeAccountId);
            const executor = createSimulatorExecutor(simulator);
            context = { simulator, executor };
            cache.set(exchangeAccountId, context);
        }
        return context;
    };
}

// ============================================================================
// Real Exchange Factory
// ============================================================================

export function createRealFactory(prisma: PrismaClient): ExecutorFactory {
    const cache = new Map<string, ExecutorContext>();

    return async (exchangeAccountId: string): Promise<ExecutorContext> => {
        let context = cache.get(exchangeAccountId);
        if (!context) {
            // 1. 获取 ExchangeAccount
            const account = await prisma.exchangeAccount.findUnique({
                where: { id: exchangeAccountId }
            });

            if (!account) {
                throw new Error(`ExchangeAccount ${exchangeAccountId} not found`);
            }

            // 2. Decrypt Credentials (supports both encrypted and plaintext)
            // Format: { apiKey: string, secret: string, ... }
            let credentials;
            try {
                const raw = account.encryptedCredentials;
                // Check if encrypted format (iv:authTag:ciphertext)
                // If so, decrypt first; otherwise parse as plaintext JSON (backward compat)
                const json = isEncryptedFormat(raw) ? decryptCredentials(raw) : raw;
                credentials = JSON.parse(json);
            } catch (e) {
                // Decrypt/parse failure - don't throw, let caller handle
                // This allows other bots to continue even if one has bad credentials
                console.error(`[ExecutorFactory] Failed to decrypt credentials for ${exchangeAccountId}:`, e);
                throw new Error(`CREDENTIALS_DECRYPT_FAILED: ${exchangeAccountId}`);
            }

            // 3. 创建 Executor
            let executor: TradingExecutor;
            if (account.exchange === 'binance') {
                const allowMainnet = process.env['ALLOW_MAINNET_TRADING'] === 'true';

                // isTestnet = !allowMainnet（默认 Testnet）
                executor = createBinanceExecutor({
                    apiKey: credentials.apiKey,
                    secret: credentials.secret,
                    isTestnet: account.isTestnet,
                    allowMainnet
                });
            } else {
                throw new Error(`Unsupported exchange: ${account.exchange}`);
            }

            context = { executor };
            cache.set(exchangeAccountId, context);
        }
        return context;
    };
}
