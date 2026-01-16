import type { MarketDataProvider, ExchangeAccountInfo } from './types.js';
import { createCcxtPublicProvider } from './ccxt-public-provider.js';

export async function createCoinbaseProvider(account: ExchangeAccountInfo): Promise<MarketDataProvider> {
    return createCcxtPublicProvider('coinbase', account);
}
