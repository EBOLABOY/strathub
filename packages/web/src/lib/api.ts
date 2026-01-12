
import { Bot, BotStatus, GridConfig, PreviewResult } from "@crypto-strategy-hub/shared";

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
        // Backend returns { error: string, code: string }
        // api.ts calls new ApiError(message, status, code)
        throw new ApiError(errorData.error || errorData.message || 'Unknown error', res.status, errorData.code);
    }
    return res.json();
}

export const api = {
    auth: {
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
        async create(data: { name: string; exchange: string; apiKey: string; secret: string; isTestnet?: boolean }) {
            const res = await fetch(`${API_BASE}/accounts`, {
                method: 'POST',
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
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ error: res.statusText, code: 'UNKNOWN' }));
                throw new ApiError(errorData.error || 'Failed to delete', res.status, errorData.code);
            }
            // 204 No Content
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
        async control(id: string, action: 'start' | 'stop' | 'pause' | 'resume') {
            const res = await fetch(`${API_BASE}/bots/${id}/${action}`, {
                method: 'POST',
                headers: getHeaders(),
            });
            return handleResponse<Bot>(res);
        }
    }
};
