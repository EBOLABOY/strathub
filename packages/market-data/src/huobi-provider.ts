import type { MarketDataProvider, ExchangeAccountInfo } from './types.js';
import { createCcxtPublicProvider } from './ccxt-public-provider.js';

export async function createHuobiProvider(account: ExchangeAccountInfo): Promise<MarketDataProvider> {
    return createCcxtPublicProvider('huobi', account);
}

export async function createHtxProvider(account: ExchangeAccountInfo): Promise<MarketDataProvider> {
    return createCcxtPublicProvider('htx', account);
}

