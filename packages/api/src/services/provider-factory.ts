/**
 * Provider Factory (compat re-export)
 *
 * 统一实现已移动到 `@crypto-strategy-hub/market-data`，这里仅保留兼容导出，避免破坏现有 import。
 */

export type {
    MarketDataProvider,
    MarketDataProviderFactory,
    ExchangeAccountInfo,
} from '@crypto-strategy-hub/market-data';

export {
    mockMarketDataProvider,
    mockProviderFactory,
    realProviderFactory,
    getProviderFactory,
} from '@crypto-strategy-hub/market-data';

