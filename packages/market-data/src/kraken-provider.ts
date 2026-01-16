import type { MarketDataProvider, ExchangeAccountInfo } from './types.js';
import { createCcxtPublicProvider } from './ccxt-public-provider.js';

export async function createKrakenProvider(account: ExchangeAccountInfo): Promise<MarketDataProvider> {
    return createCcxtPublicProvider('kraken', account);
}
