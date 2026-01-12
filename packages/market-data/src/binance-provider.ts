/**
 * Binance ccxt Provider
 *
 * 使用 ccxt 库访问 Binance 公开数据（market/ticker）
 *
 * 规则：
 * - 行情统一走 mainnet（即使 isTestnet=true）
 * - 错误统一映射为 503 EXCHANGE_UNAVAILABLE（由上层决定响应）
 * - 日志记录真实原因
 */

import ccxt, { Market, Ticker } from 'ccxt';
import type { MarketDataProvider, ExchangeAccountInfo } from './types.js';
import type { PreviewMarketInfo, PreviewTickerInfo, PreviewBalanceInfo } from '@crypto-strategy-hub/shared';
import { ExchangeUnavailableError, RateLimitError, TimeoutError } from '@crypto-strategy-hub/shared';

/**
 * 创建 Binance ccxt Provider
 *
 * @param account 已加载的 ExchangeAccount 信息
 * @returns MarketDataProvider 实例
 */
export async function createBinanceProvider(account: ExchangeAccountInfo): Promise<MarketDataProvider> {
  void account;

  // 行情统一走 mainnet
  const exchange = new ccxt.binance({
    enableRateLimit: true,
    // V1 只做公开数据，不需要密钥
    // apiKey: account.apiKey,
    // secret: account.secret,
  });

  // 预加载 markets（缓存）
  let marketsLoaded = false;
  let marketsCache: Record<string, Market> = {};

  async function ensureMarketsLoaded(): Promise<void> {
    if (marketsLoaded) {
      return;
    }

    try {
      await exchange.loadMarkets();
      marketsCache = exchange.markets;
      marketsLoaded = true;
    } catch (error) {
      logCcxtError('loadMarkets', error);
      throw mapCcxtError('loadMarkets', error);
    }
  }

  return {
    async getMarketInfo(symbol: string): Promise<PreviewMarketInfo> {
      await ensureMarketsLoaded();

      const market = marketsCache[symbol];
      if (!market) {
        console.error(`[BinanceProvider] Market not found: ${symbol}`);
        throw new Error(`Market not found: ${symbol}`);
      }

      return mapMarketToPreviewInfo(symbol, market);
    },

    async getTicker(symbol: string): Promise<PreviewTickerInfo> {
      try {
        const ticker = await exchange.fetchTicker(symbol);
        return mapTickerToPreviewInfo(ticker);
      } catch (error) {
        logCcxtError('fetchTicker', error);
        throw mapCcxtError('fetchTicker', error, symbol);
      }
    },

    async getBalance(_symbol: string): Promise<PreviewBalanceInfo | undefined> {
      // V1 返回 undefined，余额功能 V2 实现
      return undefined;
    },
  };
}

// ============================================================================
// 映射纯函数（可单独测试）
// ============================================================================

export function mapMarketToPreviewInfo(symbol: string, market: Market | undefined): PreviewMarketInfo {
  if (!market) {
    throw new Error(`Market not found: ${symbol}`);
  }
  return {
    symbol,
    pricePrecision: market.precision?.price ?? 8,
    amountPrecision: market.precision?.amount ?? 8,
    minAmount: String(market.limits?.amount?.min ?? '0.0001'),
    minNotional: String(market.limits?.cost?.min ?? '10'),
  };
}

export function mapTickerToPreviewInfo(ticker: Ticker): PreviewTickerInfo {
  const last = ticker.last ?? ticker.close;
  if (last === undefined || last === null) {
    throw new Error('Ticker has no last/close price');
  }
  return {
    last: String(last),
  };
}

// ============================================================================
// 错误日志
// ============================================================================

function logCcxtError(operation: string, error: unknown): void {
  if (error instanceof ccxt.AuthenticationError) {
    console.error(`[BinanceProvider] AUTH_FAILED in ${operation}:`, (error as Error).message);
    return;
  }
  if (error instanceof ccxt.NetworkError) {
    console.error(`[BinanceProvider] NETWORK_ERROR in ${operation}:`, (error as Error).message);
    return;
  }
  if (error instanceof ccxt.RateLimitExceeded) {
    console.error(`[BinanceProvider] RATE_LIMIT in ${operation}:`, (error as Error).message);
    return;
  }
  console.error(`[BinanceProvider] ERROR in ${operation}:`, error);
}

function mapCcxtError(operation: string, error: unknown, symbol?: string): unknown {
  if (error instanceof ccxt.RateLimitExceeded || error instanceof ccxt.DDoSProtection) {
    return new RateLimitError(undefined, error);
  }
  if (error instanceof ccxt.RequestTimeout) {
    return new TimeoutError(`Request timeout: ${operation}${symbol ? ` (${symbol})` : ''}`, error);
  }
  if (error instanceof ccxt.NetworkError || error instanceof ccxt.ExchangeNotAvailable) {
    return new ExchangeUnavailableError(`Exchange unavailable: ${operation}${symbol ? ` (${symbol})` : ''}`, error);
  }
  return error instanceof Error ? error : new ExchangeUnavailableError(`Exchange error: ${operation}`, error);
}
