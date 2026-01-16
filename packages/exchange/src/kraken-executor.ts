import type { TradingExecutor } from '@crypto-strategy-hub/shared';
import { createCcxtExecutor } from './ccxt-executor.js';

export interface KrakenExecutorConfig {
    apiKey: string;
    secret: string;
    isTestnet?: boolean;
    allowMainnet?: boolean;
}

export function createKrakenExecutor(config: KrakenExecutorConfig): TradingExecutor {
    return createCcxtExecutor({
        exchangeId: 'kraken',
        apiKey: config.apiKey,
        secret: config.secret,
        isTestnet: config.isTestnet,
        allowMainnet: config.allowMainnet,
    });
}
