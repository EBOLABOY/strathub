import type { TradingExecutor } from '@crypto-strategy-hub/shared';
import { createCcxtExecutor } from './ccxt-executor.js';

export interface CoinbaseExecutorConfig {
    apiKey: string;
    secret: string;
    isTestnet?: boolean;
    allowMainnet?: boolean;
}

export function createCoinbaseExecutor(config: CoinbaseExecutorConfig): TradingExecutor {
    return createCcxtExecutor({
        exchangeId: 'coinbase',
        apiKey: config.apiKey,
        secret: config.secret,
        isTestnet: config.isTestnet,
        allowMainnet: config.allowMainnet,
    });
}
