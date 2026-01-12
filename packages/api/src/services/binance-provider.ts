/**
 * Binance Provider (compat re-export)
 *
 * 统一实现已移动到 `@crypto-strategy-hub/market-data`。
 */

export type { ExchangeAccountInfo } from '@crypto-strategy-hub/market-data';

export {
    createBinanceProvider,
    mapMarketToPreviewInfo,
    mapTickerToPreviewInfo,
} from '@crypto-strategy-hub/market-data';

