import ccxt, { type Exchange } from 'ccxt';
import { getCcxtProxyConfig, trySetSandboxMode } from './proxy.js';

let cachedExchangeIds: Set<string> | null = null;

function computeExchangeIds(): Set<string> {
    const explicit = (ccxt as any).exchanges as unknown;
    if (Array.isArray(explicit)) {
        return new Set<string>(explicit.map((id) => String(id).toLowerCase()));
    }

    // Fallback for test environments where ccxt is mocked and `ccxt.exchanges` is absent.
    const ids: string[] = [];
    for (const key of Object.keys(ccxt)) {
        if (!/^[a-z0-9_]+$/.test(key)) continue;
        if (key === 'pro') continue;
        const value = (ccxt as any)[key] as unknown;
        if (typeof value !== 'function') continue;
        ids.push(key);
    }
    return new Set<string>(ids);
}

function getExchangeIds(): Set<string> {
    if (!cachedExchangeIds) {
        cachedExchangeIds = computeExchangeIds();
    }
    return cachedExchangeIds;
}

export function normalizeCcxtExchangeId(exchange: string): string | null {
    const normalized = exchange.trim().toLowerCase();
    if (!normalized) return null;
    return getExchangeIds().has(normalized) ? normalized : null;
}

export function isCcxtExchangeSupported(exchange: string): boolean {
    return normalizeCcxtExchangeId(exchange) !== null;
}

const sandboxSupportCache = new Map<string, boolean>();

function createCcxtExchange(exchangeId: string): Exchange {
    const Ctor = (ccxt as any)[exchangeId] as (new (...args: any[]) => Exchange) | undefined;
    if (!Ctor) {
        throw new Error(`Unsupported CCXT exchange: ${exchangeId}`);
    }

    const proxyConfig = getCcxtProxyConfig();
    return new Ctor({
        enableRateLimit: true,
        ...proxyConfig,
    });
}

export function supportsCcxtSandbox(exchange: string): boolean {
    const normalized = normalizeCcxtExchangeId(exchange);
    if (!normalized) return false;

    const cached = sandboxSupportCache.get(normalized);
    if (cached !== undefined) return cached;

    try {
        const instance = createCcxtExchange(normalized);
        const supported = trySetSandboxMode(instance, true);
        sandboxSupportCache.set(normalized, supported);
        return supported;
    } catch {
        sandboxSupportCache.set(normalized, false);
        return false;
    }
}
