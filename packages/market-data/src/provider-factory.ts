/**
 * Provider Factory
 *
 * 根据 ExchangeAccount 创建对应的 MarketDataProvider
 */

import type { MarketDataProvider, MarketDataProviderFactory, ExchangeAccountInfo } from './types.js';
import { createBinanceProvider } from './binance-provider.js';
import type { PreviewMarketInfo, PreviewTickerInfo, PreviewBalanceInfo } from '@crypto-strategy-hub/shared';

// ============================================================================
// Mock Provider Factory（测试用）
// ============================================================================

export const mockMarketDataProvider: MarketDataProvider = {
  async getMarketInfo(symbol: string): Promise<PreviewMarketInfo> {
    return {
      symbol,
      pricePrecision: 2,
      amountPrecision: 4,
      minAmount: '0.01',
      minNotional: '10',
    };
  },

  async getTicker(_symbol: string): Promise<PreviewTickerInfo> {
    return {
      last: '580.00',
    };
  },

  async getBalance(_symbol: string): Promise<PreviewBalanceInfo | undefined> {
    return undefined;
  },
};

export const mockProviderFactory: MarketDataProviderFactory = {
  async createProvider(_account: ExchangeAccountInfo): Promise<MarketDataProvider> {
    return mockMarketDataProvider;
  },
};

// ============================================================================
// Real Provider Factory（生产用）
// ============================================================================

export const realProviderFactory: MarketDataProviderFactory = {
  async createProvider(account: ExchangeAccountInfo): Promise<MarketDataProvider> {
    switch (account.exchange.toLowerCase()) {
      case 'binance':
        return createBinanceProvider(account);
      default:
        console.warn(`[ProviderFactory] Unknown exchange: ${account.exchange}, using mock`);
        return mockMarketDataProvider;
    }
  },
};

// ============================================================================
// 根据环境选择 Factory
// ============================================================================

export function getProviderFactory(): MarketDataProviderFactory {
  const useReal = process.env['EXCHANGE_PROVIDER'] === 'real';
  if (useReal) {
    console.log('[ProviderFactory] Using REAL exchange provider');
    return realProviderFactory;
  }
  console.log('[ProviderFactory] Using MOCK exchange provider');
  return mockProviderFactory;
}

