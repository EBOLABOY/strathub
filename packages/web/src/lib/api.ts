
import { Bot, BotStatus, GridConfig, PreviewResult, Balance, type SupportedExchangeId } from "@crypto-strategy-hub/shared";

const API_BASE = '/api';

export class ApiError extends Error {
    constructor(message: string, public status: number, public code: string) {
        super(message);
    }
}

function getHeaders() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    return {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

async function handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
        let errorData;
        try {
            errorData = await res.json();
        } catch {
            errorData = { error: res.statusText, code: 'UNKNOWN' };
        }
        throw new ApiError(errorData.error || errorData.message || 'Unknown error', res.status, errorData.code);
    }
    return res.json();
}

async function handleVoidResponse(res: Response): Promise<void> {
    if (!res.ok) {
        let errorData;
        try {
            errorData = await res.json();
        } catch {
            errorData = { error: res.statusText, code: 'UNKNOWN' };
        }
        throw new ApiError(errorData.error || errorData.message || 'Unknown error', res.status, errorData.code);
    }
}

export const api = {
    auth: {
        async register(email: string, password: string) {
            const res = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            return handleResponse<any>(res);
        },
        async login(email: string, password: string) {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            return handleResponse<{ token: string; user: any }>(res);
        },
        async me() {
            const res = await fetch(`${API_BASE}/auth/me`, { headers: getHeaders() });
            return handleResponse<any>(res);
        }
    },
    accounts: {
        async list() {
            const res = await fetch(`${API_BASE}/accounts`, { headers: getHeaders() });
            return handleResponse<any[]>(res);
        },
        async create(data: {
            name: string;
            exchange: SupportedExchangeId;
            apiKey: string;
            secret: string;
            passphrase?: string;
            isTestnet?: boolean;
        }) {
            const res = await fetch(`${API_BASE}/accounts`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify(data),
            });
            return handleResponse<any>(res);
        },
        async update(
            id: string,
            data: { name?: string; apiKey?: string; secret?: string; passphrase?: string; isTestnet?: boolean }
        ) {
            const res = await fetch(`${API_BASE}/accounts/${id}`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify(data),
            });
            return handleResponse<any>(res);
        },
        async delete(id: string) {
            const res = await fetch(`${API_BASE}/accounts/${id}`, {
                method: 'DELETE',
                headers: getHeaders(),
            });
            await handleVoidResponse(res);
        },
        async getBalance(id: string) {
            const res = await fetch(`${API_BASE}/accounts/${id}/balance`, { headers: getHeaders() });
            return handleResponse<Record<string, Balance>>(res);
        }
    },
    bots: {
        async list() {
            const res = await fetch(`${API_BASE}/bots`, { headers: getHeaders() });
            return handleResponse<Bot[]>(res);
        },
        async get(id: string) {
            const res = await fetch(`${API_BASE}/bots/${id}`, { headers: getHeaders() });
            return handleResponse<Bot>(res);
        },
        async getRuntime(id: string) {
            const res = await fetch(`${API_BASE}/bots/${id}/runtime`, { headers: getHeaders() });
            return handleResponse<{
                status: BotStatus;
                statusVersion: number;
                runId: string | null;
                lastError: string | null;
                snapshot: any;
            }>(res);
        },
        async create(data: { exchangeAccountId: string; symbol: string; configJson: string }) {
            const res = await fetch(`${API_BASE}/bots`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify(data),
            });
            return handleResponse<Bot>(res);
        },
        async updateConfig(id: string, configJson: string) {
            const res = await fetch(`${API_BASE}/bots/${id}/config`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify({ configJson }),
            });
            return handleResponse<Bot>(res);
        },
        async preview(id: string, override?: Partial<GridConfig>) {
            const res = await fetch(`${API_BASE}/bots/${id}/preview`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ configOverride: override }),
            });
            return handleResponse<PreviewResult>(res);
        },
        async delete(id: string) {
            const res = await fetch(`${API_BASE}/bots/${id}`, {
                method: 'DELETE',
                headers: getHeaders(),
            });
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ error: res.statusText, code: 'UNKNOWN' }));
                throw new ApiError(errorData.error || 'Failed to delete', res.status, errorData.code);
            }
        },
        async control(id: string, action: 'start' | 'stop' | 'pause' | 'resume') {
            const res = await fetch(`${API_BASE}/bots/${id}/${action}`, {
                method: 'POST',
                headers: getHeaders(),
            });
            return handleResponse<Bot>(res);
        },
        async getOrders(id: string, page = 1, limit = 20) {
            const res = await fetch(`${API_BASE}/bots/${id}/orders?page=${page}&limit=${limit}`, { headers: getHeaders() });
            return handleResponse<{ orders: any[]; total: number }>(res);
        },
        async getTrades(id: string, page = 1, limit = 20) {
            const res = await fetch(`${API_BASE}/bots/${id}/trades?page=${page}&limit=${limit}`, { headers: getHeaders() });
            return handleResponse<{ trades: any[]; total: number }>(res);
        }
    },
    config: {
        async list() {
            const res = await fetch(`${API_BASE}/config`, { headers: getHeaders() });
            return handleResponse<ConfigItem[]>(res);
        },
        async get(key: string) {
            const res = await fetch(`${API_BASE}/config/${key}`, { headers: getHeaders() });
            return handleResponse<ConfigItem>(res);
        },
        async update(key: string, value: string, description?: string) {
            const res = await fetch(`${API_BASE}/config/${key}`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify({ value, description }),
            });
            return handleResponse<ConfigItem>(res);
        },
        async batchUpdate(items: { key: string; value: string }[]) {
            const res = await fetch(`${API_BASE}/config/batch`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify({ items }),
            });
            return handleResponse<{ updated: number }>(res);
        },
        async getHistory(key: string) {
            const res = await fetch(`${API_BASE}/config/${key}/history`, { headers: getHeaders() });
            return handleResponse<ConfigHistory[]>(res);
        },
        async rollback(key: string, historyId: string) {
            const res = await fetch(`${API_BASE}/config/${key}/rollback`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ historyId }),
            });
            return handleResponse<ConfigItem>(res);
        },
        async export() {
            const res = await fetch(`${API_BASE}/config/export`, { headers: getHeaders() });
            return handleResponse<{ configs: ConfigItem[] }>(res);
        },
        async import(configs: { key: string; value: string; description?: string }[]) {
            const res = await fetch(`${API_BASE}/config/import`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ configs }),
            });
            return handleResponse<{ imported: number }>(res);
        }
    },
    templates: {
        async list() {
            const res = await fetch(`${API_BASE}/templates`, { headers: getHeaders() });
            return handleResponse<ConfigTemplate[]>(res);
        },
        async get(id: string) {
            const res = await fetch(`${API_BASE}/templates/${id}`, { headers: getHeaders() });
            return handleResponse<ConfigTemplate>(res);
        },
        async create(data: { name: string; description?: string; configJson: string }) {
            const res = await fetch(`${API_BASE}/templates`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify(data),
            });
            return handleResponse<ConfigTemplate>(res);
        },
        async update(id: string, data: { name?: string; description?: string; configJson?: string }) {
            const res = await fetch(`${API_BASE}/templates/${id}`, {
                method: 'PUT',
                headers: getHeaders(),
                body: JSON.stringify(data),
            });
            return handleResponse<ConfigTemplate>(res);
        },
        async delete(id: string) {
            const res = await fetch(`${API_BASE}/templates/${id}`, {
                method: 'DELETE',
                headers: getHeaders(),
            });
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ error: res.statusText, code: 'UNKNOWN' }));
                throw new ApiError(errorData.error || 'Failed to delete', res.status, errorData.code);
            }
        },
        async apply(templateId: string, botId: string) {
            const res = await fetch(`${API_BASE}/templates/${templateId}/apply`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ botId }),
            });
            return handleResponse<Bot>(res);
        }
    },
    market: {
        async getTicker(symbol: string) {
            const res = await fetch(`${API_BASE}/market/ticker/${encodeURIComponent(symbol)}`, { headers: getHeaders() });
            return handleResponse<TickerInfo>(res);
        },
        async getBotTicker(botId: string) {
            const res = await fetch(`${API_BASE}/market/bot/${botId}/ticker`, { headers: getHeaders() });
            return handleResponse<BotTickerInfo>(res);
        },
        async getBotMarketInfo(botId: string) {
            const res = await fetch(`${API_BASE}/market/bot/${botId}/market-info`, { headers: getHeaders() });
            return handleResponse<MarketInfo>(res);
        }
    },
    dashboard: {
        async getStats() {
            const res = await fetch(`${API_BASE}/dashboard/stats`, { headers: getHeaders() });
            return handleResponse<DashboardStats>(res);
        },
        async getChart(period: '1h' | '1d' | '1w' | '1m' | '1y' = '1d') {
            const res = await fetch(`${API_BASE}/dashboard/chart?period=${period}`, { headers: getHeaders() });
            return handleResponse<ChartDataPoint[]>(res);
        }
    }
};

// Types
export interface ConfigItem {
    id: string;
    key: string;
    value: string;
    description?: string;
    category: string;
    createdAt: string;
    updatedAt: string;
}

export interface ConfigHistory {
    id: string;
    configItemId: string;
    oldValue: string;
    newValue: string;
    changedBy?: string;
    changedAt: string;
}

export interface ConfigTemplate {
    id: string;
    name: string;
    description?: string;
    configJson: string;
    createdAt: string;
    updatedAt: string;
}

export interface TickerInfo {
    symbol: string;
    price: number;
    timestamp: number;
}

export interface BotTickerInfo {
    symbol: string;
    price: number;
    priceFormatted: string;
    timestamp: number;
    triggerInfo: {
        sellTriggerPrice: string;
        buyTriggerPrice: string;
        sellDistance: string;
        buyDistance: string;
        riseSell: number;
        fallBuy: number;
    } | null;
}

export interface MarketInfo {
    symbol: string;
    pricePrecision: number;
    amountPrecision: number;
    minAmount: string;
    minNotional: string;
}

export interface DashboardStats {
    totalAssets: number;
    totalAssetsTrend: string;
    activeBots: number;
    totalBots: number;
    winRate: string;
    winRateTrend: string;
    volume24h: number;
    volume24hTrend: string;
    pnl24h: Record<string, number>;
}

export interface ChartDataPoint {
    name: string;
    value: number;
}
