import type { TradingExecutor } from '@crypto-strategy-hub/shared';
import { createCcxtExecutor } from './ccxt-executor.js';

export interface HuobiExecutorConfig {
    apiKey: string;
    secret: string;
    isTestnet?: boolean;
    allowMainnet?: boolean;
}

export function createHuobiExecutor(config: HuobiExecutorConfig): TradingExecutor {
    return createCcxtExecutor({
        exchangeId: 'huobi',
        apiKey: config.apiKey,
        secret: config.secret,
        isTestnet: config.isTestnet,
        allowMainnet: config.allowMainnet,
    });
}

export function createHtxExecutor(config: HuobiExecutorConfig): TradingExecutor {
    return createCcxtExecutor({
        exchangeId: 'htx',
        apiKey: config.apiKey,
        secret: config.secret,
        isTestnet: config.isTestnet,
        allowMainnet: config.allowMainnet,
    });
}

