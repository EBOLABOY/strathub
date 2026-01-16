import type { Market, Ticker } from 'ccxt';
import type { PreviewMarketInfo, PreviewTickerInfo } from '@crypto-strategy-hub/shared';

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

