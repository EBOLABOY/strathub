/**
 * Provider Factory
 *
 * 根据 ExchangeAccount 创建对应的 MarketDataProvider
 */

import type { MarketDataProvider, MarketDataProviderFactory, ExchangeAccountInfo } from './types.js';
import { createBinanceProvider } from './binance-provider.js';
import { createCcxtPublicProvider } from './ccxt-public-provider.js';
import {
  normalizeSupportedExchangeId,
  type PreviewMarketInfo,
  type PreviewTickerInfo,
  type PreviewBalanceInfo,
  type PreviewOrderBookInfo,
} from '@crypto-strategy-hub/shared';

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

  async getOrderBook(_symbol: string, depth: number = 5): Promise<PreviewOrderBookInfo> {
    const levels = Math.max(1, Math.min(50, Math.trunc(depth)));
    const last = 580.0;
    const bids = Array.from({ length: levels }, (_, i) => ({
      price: (last - (i + 1) * 0.01).toFixed(2),
      amount: '1',
    }));
    const asks = Array.from({ length: levels }, (_, i) => ({
      price: (last + (i + 1) * 0.01).toFixed(2),
      amount: '1',
    }));
    return { bids, asks };
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
// Simulated Provider Factory（本地开发用，无网络，价格会随时间波动）
// ============================================================================

function stableStringHash(input: string): number {
  // Simple, stable hash for small strings (not crypto).
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function computeSimulatedLast(symbol: string): string {
  const base = readNumberEnv('SIM_TICKER_BASE', 580);
  const amplitudePct = readNumberEnv('SIM_TICKER_AMPLITUDE_PCT', 1);
  const periodMs = Math.max(1000, readIntEnv('SIM_TICKER_PERIOD_MS', 30_000));

  // Stable per-symbol phase so multiple symbols aren't perfectly in sync.
  const phase = (stableStringHash(symbol) % 360) * (Math.PI / 180);
  const omega = (2 * Math.PI) / periodMs;
  const t = Date.now();

  const factor = 1 + (amplitudePct / 100) * Math.sin(omega * t + phase);
  const last = Math.max(0.0001, base * factor);

  // Keep it simple: 2 decimals (align with mock pricePrecision=2).
  return last.toFixed(2);
}

export const simulatedMarketDataProvider: MarketDataProvider = {
  async getMarketInfo(symbol: string): Promise<PreviewMarketInfo> {
    return {
      symbol,
      pricePrecision: 2,
      amountPrecision: 4,
      minAmount: '0.01',
      minNotional: '10',
    };
  },

  async getTicker(symbol: string): Promise<PreviewTickerInfo> {
    return {
      last: computeSimulatedLast(symbol),
    };
  },

  async getOrderBook(symbol: string, depth: number = 5): Promise<PreviewOrderBookInfo> {
    const levels = Math.max(1, Math.min(50, Math.trunc(depth)));
    const last = Number(computeSimulatedLast(symbol));
    const base = Number.isFinite(last) ? last : 580.0;
    const bids = Array.from({ length: levels }, (_, i) => ({
      price: Math.max(0.0001, base - (i + 1) * 0.01).toFixed(2),
      amount: '1',
    }));
    const asks = Array.from({ length: levels }, (_, i) => ({
      price: Math.max(0.0001, base + (i + 1) * 0.01).toFixed(2),
      amount: '1',
    }));
    return { bids, asks };
  },

  async getBalance(_symbol: string): Promise<PreviewBalanceInfo | undefined> {
    return undefined;
  },
};

export const simulatedProviderFactory: MarketDataProviderFactory = {
  async createProvider(_account: ExchangeAccountInfo): Promise<MarketDataProvider> {
    return simulatedMarketDataProvider;
  },
};

// ============================================================================
// Real Provider Factory（生产用）
// ============================================================================

export const realProviderFactory: MarketDataProviderFactory = {
  async createProvider(account: ExchangeAccountInfo): Promise<MarketDataProvider> {
    const exchangeId = normalizeSupportedExchangeId(account.exchange);
    if (!exchangeId) {
      throw new Error(`Unsupported exchange: ${account.exchange}`);
    }

    // Keep Binance special-cased: it has resilient fallback spot API bases.
    if (exchangeId === 'binance') {
      return createBinanceProvider(account);
    }

    return createCcxtPublicProvider(exchangeId, account);
  },
};

// ============================================================================
// 根据环境选择 Factory
// ============================================================================

export function getProviderFactory(): MarketDataProviderFactory {
  const provider = (process.env['EXCHANGE_PROVIDER'] ?? 'mock').toLowerCase();

  if (provider === 'real') {
    console.log('[ProviderFactory] Using REAL exchange provider');
    return realProviderFactory;
  }

  if (provider === 'sim' || provider === 'simulated') {
    console.log('[ProviderFactory] Using SIMULATED exchange provider');
    return simulatedProviderFactory;
  }

  console.log('[ProviderFactory] Using MOCK exchange provider');
  return mockProviderFactory;
}
