import type { TradingExecutor } from '@crypto-strategy-hub/shared';
import { createCcxtExecutor } from './ccxt-executor.js';

export interface OkxExecutorConfig {
    apiKey: string;
    secret: string;
    passphrase: string;
    isTestnet?: boolean;
    allowMainnet?: boolean;
}

export function createOkxExecutor(config: OkxExecutorConfig): TradingExecutor {
    return createCcxtExecutor({
        exchangeId: 'okx',
        apiKey: config.apiKey,
        secret: config.secret,
        passphrase: config.passphrase,
        isTestnet: config.isTestnet,
        allowMainnet: config.allowMainnet,
    });
}

