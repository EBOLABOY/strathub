import type {
  PreviewMarketInfo,
  PreviewTickerInfo,
  PreviewBalanceInfo,
} from '@crypto-strategy-hub/shared';

export interface MarketDataProvider {
  getMarketInfo(symbol: string): Promise<PreviewMarketInfo>;
  getTicker(symbol: string): Promise<PreviewTickerInfo>;
  getBalance(symbol: string): Promise<PreviewBalanceInfo | undefined>;
}

export interface ExchangeAccountInfo {
  id: string;
  exchange: string;
  apiKey?: string;
  secret?: string;
  passphrase?: string;
  isTestnet?: boolean;
}

export interface MarketDataProviderFactory {
  createProvider(account: ExchangeAccountInfo): Promise<MarketDataProvider>;
}

