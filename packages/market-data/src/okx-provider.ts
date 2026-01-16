import type { MarketDataProvider, ExchangeAccountInfo } from './types.js';
import { createCcxtPublicProvider } from './ccxt-public-provider.js';

export async function createOkxProvider(account: ExchangeAccountInfo): Promise<MarketDataProvider> {
    return createCcxtPublicProvider('okx', account);
}

