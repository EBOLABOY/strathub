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

type CcxtProxyConfig = Partial<{
  httpProxy: string;
  httpsProxy: string;
  socksProxy: string;
  httpProxyCallback: (url: string, method?: string, headers?: any, body?: any) => string | undefined;
  httpsProxyCallback: (url: string, method?: string, headers?: any, body?: any) => string | undefined;
  socksProxyCallback: (url: string, method?: string, headers?: any, body?: any) => string | undefined;
}>;

type ProxyType = 'http' | 'https' | 'socks';
type ProxySpec = { type: ProxyType; url: string };

function readCcxtProxyUrl(): string | undefined {
  const raw =
    process.env['CCXT_PROXY_URL'] ||
    process.env['CCXT_PROXY'] ||
    process.env['ALL_PROXY'] ||
    process.env['all_proxy'] ||
    process.env['HTTPS_PROXY'] ||
    process.env['https_proxy'] ||
    process.env['HTTP_PROXY'] ||
    process.env['http_proxy'];

  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function parseProxySpec(raw: string): ProxySpec | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('socks')) return { type: 'socks', url: trimmed };
  if (lower.startsWith('https://')) return { type: 'https', url: trimmed };
  if (lower.startsWith('http://')) return { type: 'http', url: trimmed };

  // Host:port without scheme → assume http proxy.
  if (/^[^\s:]+:\d+$/.test(trimmed)) {
    return { type: 'http', url: `http://${trimmed}` };
  }

  // Unknown format: let ccxt deal with it (treat as http proxy string).
  return { type: 'http', url: trimmed };
}

function readNoProxyList(): string[] {
  const raw = process.env['CCXT_NO_PROXY'] || process.env['NO_PROXY'] || process.env['no_proxy'];
  if (!raw) return [];

  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function stripPort(host: string): string {
  const idx = host.lastIndexOf(':');
  if (idx === -1) return host;
  const port = host.slice(idx + 1);
  if (/^\d+$/.test(port)) return host.slice(0, idx);
  return host;
}

function matchesNoProxy(hostname: string, noProxyList: string[]): boolean {
  for (const raw of noProxyList) {
    const rule = stripPort(raw.trim().toLowerCase());
    if (!rule) continue;
    if (rule === '*') return true;

    const normalized = rule.startsWith('.') ? rule.slice(1) : rule;
    if (!normalized) continue;

    if (hostname === normalized) return true;
    if (hostname.endsWith(`.${normalized}`)) return true;
  }
  return false;
}

function createProxyCallback(proxyUrl: string, noProxyList: string[]) {
  const rules = noProxyList.map((s) => s.trim()).filter(Boolean);
  if (rules.length === 0) {
    return () => proxyUrl;
  }

  return (url: string) => {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (matchesNoProxy(hostname, rules)) return undefined;
      return proxyUrl;
    } catch {
      return proxyUrl;
    }
  };
}

function getCcxtProxyConfig(): CcxtProxyConfig {
  const proxyUrl = readCcxtProxyUrl();
  if (!proxyUrl) return {};

  const spec = parseProxySpec(proxyUrl);
  if (!spec) return {};

  const noProxyList = readNoProxyList();
  if (noProxyList.length > 0) {
    const callback = createProxyCallback(spec.url, noProxyList);
    if (spec.type === 'socks') return { socksProxyCallback: callback };
    if (spec.type === 'https') return { httpsProxyCallback: callback };
    return { httpProxyCallback: callback };
  }

  if (spec.type === 'socks') return { socksProxy: spec.url };
  if (spec.type === 'https') return { httpsProxy: spec.url };
  return { httpProxy: spec.url };
}

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
          logCcxtError('loadMarkets', error2);
          throw mapCcxtError('loadMarkets', error2);
        }
      }

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
      await ensureMarketsLoaded();
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
