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
import type { PreviewMarketInfo, PreviewTickerInfo, PreviewBalanceInfo, PreviewOrderBookInfo } from '@crypto-strategy-hub/shared';
import { getCcxtProxyConfig, logCcxtError, mapCcxtError } from '@crypto-strategy-hub/ccxt-utils';
import { mapMarketToPreviewInfo, mapTickerToPreviewInfo } from './mappers.js';

/**
 * 创建 Binance ccxt Provider
 *
 * @param account 已加载的 ExchangeAccount 信息
 * @returns MarketDataProvider 实例
 */
export async function createBinanceProvider(account: ExchangeAccountInfo): Promise<MarketDataProvider> {
  void account;

  // 行情统一走 mainnet
  const proxyConfig = getCcxtProxyConfig();
  const exchange = new ccxt.binance({
    enableRateLimit: true,
    ...proxyConfig,
    options: {
      defaultType: 'spot',
      fetchMarkets: { types: ['spot'] },
    },
    // V1 只做公开数据，不需要密钥
    // apiKey: account.apiKey,
    // secret: account.secret,
  });

  const primarySpotBase = process.env['BINANCE_SPOT_API_BASE']?.trim() || 'https://api.binance.com';
  const fallbackSpotBase = process.env['BINANCE_SPOT_API_FALLBACK_BASE']?.trim() || 'https://data-api.binance.vision';
  let usingFallback = false;

  function joinUrl(base: string, suffix: string): string {
    return `${base.replace(/\/+$/, '')}${suffix}`;
  }

  function setSpotRestBase(base: string): void {
    const urls = (exchange as any).urls as any;
    if (!urls?.api || typeof urls.api === 'string') return;

    urls.api.public = joinUrl(base, '/api/v3');
    urls.api.private = joinUrl(base, '/api/v3');
    urls.api.v1 = joinUrl(base, '/api/v1');
  }

  setSpotRestBase(primarySpotBase);

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
      const canFallback =
        !usingFallback &&
        (error instanceof ccxt.NetworkError ||
          error instanceof ccxt.ExchangeNotAvailable ||
          error instanceof ccxt.RequestTimeout);

      if (canFallback) {
        usingFallback = true;
        setSpotRestBase(fallbackSpotBase);

        try {
          await exchange.loadMarkets();
          marketsCache = exchange.markets;
          marketsLoaded = true;
          return;
        } catch (error2) {
          logCcxtError('BinanceProvider', 'loadMarkets', error2);
          throw mapCcxtError('loadMarkets', error2);
        }
      }

      logCcxtError('BinanceProvider', 'loadMarkets', error);
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
      await ensureMarketsLoaded();
      try {
        const ticker = await exchange.fetchTicker(symbol);
        return mapTickerToPreviewInfo(ticker);
      } catch (error) {
        logCcxtError('BinanceProvider', 'fetchTicker', error);
        throw mapCcxtError('fetchTicker', error, symbol);
      }
    },

    async getOrderBook(symbol: string, depth: number = 5): Promise<PreviewOrderBookInfo> {
      await ensureMarketsLoaded();
      const limit = Math.max(1, Math.min(50, Math.trunc(depth)));
      try {
        const ob = await exchange.fetchOrderBook(symbol, limit);
        const bids = (ob.bids ?? []).slice(0, limit).map((l) => ({ price: String(l[0]), amount: String(l[1]) }));
        const asks = (ob.asks ?? []).slice(0, limit).map((l) => ({ price: String(l[0]), amount: String(l[1]) }));
        return { bids, asks };
      } catch (error) {
        logCcxtError('BinanceProvider', 'fetchOrderBook', error);
        throw mapCcxtError('fetchOrderBook', error, symbol);
      }
    },

    async getBalance(_symbol: string): Promise<PreviewBalanceInfo | undefined> {
      // V1 返回 undefined，余额功能 V2 实现
      return undefined;
    },
  };
}
