/**
 * Generic CCXT public market-data provider
 *
 * Supports:
 * - loadMarkets (cached)
 * - fetchTicker
 *
 * Notes:
 * - V1 only uses public endpoints (no credentials).
 * - Errors are mapped to shared ExchangeError types.
 */

import ccxt, { type Exchange, type Market } from 'ccxt';
import type { MarketDataProvider, ExchangeAccountInfo } from './types.js';
import type { PreviewMarketInfo, PreviewTickerInfo, PreviewBalanceInfo, PreviewOrderBookInfo } from '@crypto-strategy-hub/shared';
import { getCcxtProxyConfig, logCcxtError, mapCcxtError } from '@crypto-strategy-hub/ccxt-utils';
import { mapMarketToPreviewInfo, mapTickerToPreviewInfo } from './mappers.js';

function createCcxtExchange(exchangeId: string): Exchange {
    const Ctor = (ccxt as any)[exchangeId] as (new (...args: any[]) => Exchange) | undefined;
    if (!Ctor) {
        throw new Error(`Unsupported CCXT exchange: ${exchangeId}`);
    }

    const proxyConfig = getCcxtProxyConfig();
    return new Ctor({
        enableRateLimit: true,
        ...proxyConfig,
        options: {
            defaultType: 'spot',
            fetchMarkets: { types: ['spot'] },
        },
    });
}

export async function createCcxtPublicProvider(
    exchangeId: string,
    _account: ExchangeAccountInfo
): Promise<MarketDataProvider> {
    const exchange = createCcxtExchange(exchangeId);
    const tag = `CcxtProvider:${exchangeId}`;

    let marketsLoaded = false;
    let marketsCache: Record<string, Market> = {};

    async function ensureMarketsLoaded(): Promise<void> {
        if (marketsLoaded) return;
        try {
            await exchange.loadMarkets();
            marketsCache = exchange.markets;
            marketsLoaded = true;
        } catch (error) {
            logCcxtError(tag, 'loadMarkets', error);
            throw mapCcxtError('loadMarkets', error);
        }
    }

    return {
        async getMarketInfo(symbol: string): Promise<PreviewMarketInfo> {
            await ensureMarketsLoaded();

            const market = marketsCache[symbol];
            if (!market) {
                console.error(`[${tag}] Market not found: ${symbol}`);
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
                logCcxtError(tag, 'fetchTicker', error);
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
                logCcxtError(tag, 'fetchOrderBook', error);
                throw mapCcxtError('fetchOrderBook', error, symbol);
            }
        },

        async getBalance(_symbol: string): Promise<PreviewBalanceInfo | undefined> {
            // V1 returns undefined. Balance is handled by trading executor.
            return undefined;
        },
    };
}
