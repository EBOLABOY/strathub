import type { Exchange } from 'ccxt';

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

    // Host:port without scheme: assume http proxy.
    if (/^[^\s:]+:\d+$/.test(trimmed)) {
        return { type: 'http', url: `http://${trimmed}` };
    }

    // Unknown format: let ccxt deal with it.
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

export function getCcxtProxyConfig(): CcxtProxyConfig {
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

export function trySetSandboxMode(exchange: Exchange, enabled: boolean): boolean {
    if (!enabled) return true;

    const hasSandbox = (exchange as any).has?.sandbox;
    if (hasSandbox === false) return false;

    try {
        exchange.setSandboxMode(true);
        return true;
    } catch (error) {
        const name = (exchange as any).id ?? (exchange as any).name ?? 'unknown';
        console.warn(`[CcxtUtils] Exchange ${name} does not support sandbox mode:`, (error as Error).message);
        return false;
    }
}
