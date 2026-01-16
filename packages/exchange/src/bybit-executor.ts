import type { TradingExecutor } from '@crypto-strategy-hub/shared';
import { createCcxtExecutor } from './ccxt-executor.js';

export interface BybitExecutorConfig {
    apiKey: string;
    secret: string;
    isTestnet?: boolean;
    allowMainnet?: boolean;
}

export function createBybitExecutor(config: BybitExecutorConfig): TradingExecutor {
    return createCcxtExecutor({
        exchangeId: 'bybit',
        apiKey: config.apiKey,
        secret: config.secret,
        isTestnet: config.isTestnet,
        allowMainnet: config.allowMainnet,
    });
}
