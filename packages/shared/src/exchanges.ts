export const KNOWN_EXCHANGES = [
    'binance',
    'okx',
    'bybit',
    'coinbase',
    'kraken',
] as const;
export type ExchangeId = (typeof KNOWN_EXCHANGES)[number];

// Supported = implemented end-to-end (market-data + trading executor + worker paths).
export const SUPPORTED_EXCHANGES = KNOWN_EXCHANGES;
export type SupportedExchangeId = (typeof SUPPORTED_EXCHANGES)[number];

// Featured = shown in the UI by default.
export const FEATURED_EXCHANGES = SUPPORTED_EXCHANGES;
export type FeaturedExchangeId = (typeof FEATURED_EXCHANGES)[number];

export interface ExchangeCredentials {
    apiKey: string;
    secret: string;
    passphrase?: string;
}

export interface ExchangeCapabilities {
    ccxtId: SupportedExchangeId;
    supportsSandbox: boolean;
    requiresPassphrase: boolean;
}

export const EXCHANGE_CAPABILITIES: Record<SupportedExchangeId, ExchangeCapabilities> = {
    binance: { ccxtId: 'binance', supportsSandbox: true, requiresPassphrase: false },
    okx: { ccxtId: 'okx', supportsSandbox: true, requiresPassphrase: true },
    bybit: { ccxtId: 'bybit', supportsSandbox: true, requiresPassphrase: false },
    coinbase: { ccxtId: 'coinbase', supportsSandbox: false, requiresPassphrase: false },
    kraken: { ccxtId: 'kraken', supportsSandbox: false, requiresPassphrase: false },
};

export function requiresPassphrase(exchange: string): boolean {
    const normalized = normalizeSupportedExchangeId(exchange);
    if (!normalized) return false;
    return EXCHANGE_CAPABILITIES[normalized].requiresPassphrase;
}

export function supportsTestnet(exchange: string): boolean {
    const normalized = normalizeSupportedExchangeId(exchange);
    if (!normalized) return false;
    return EXCHANGE_CAPABILITIES[normalized].supportsSandbox;
}

export function normalizeExchangeId(exchange: string): ExchangeId | null {
    const normalized = exchange.toLowerCase();
    return (KNOWN_EXCHANGES as readonly string[]).includes(normalized) ? (normalized as ExchangeId) : null;
}

export function normalizeSupportedExchangeId(exchange: string): SupportedExchangeId | null {
    const normalized = exchange.toLowerCase();
    return (SUPPORTED_EXCHANGES as readonly string[]).includes(normalized) ? (normalized as SupportedExchangeId) : null;
}

export function isSupportedExchange(exchange: string): boolean {
    return normalizeSupportedExchangeId(exchange) !== null;
}

export function isFeaturedExchange(exchange: string): boolean {
    const normalized = exchange.toLowerCase();
    return (FEATURED_EXCHANGES as readonly string[]).includes(normalized);
}
