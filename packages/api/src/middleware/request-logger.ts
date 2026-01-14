/**
 * Request Logger Middleware
 */

import type { Request, Response, NextFunction } from 'express';

type LogHttpMode = 'all' | 'errors' | 'slow' | 'none';

function readLogHttpMode(): LogHttpMode {
    const raw = (process.env['LOG_HTTP'] ?? '').trim().toLowerCase();
    if (!raw) return 'errors'; // best-practice default: don't spam logs for polling UIs
    if (raw === '1' || raw === 'true' || raw === 'yes') return 'all';
    if (raw === '0' || raw === 'false' || raw === 'no') return 'none';
    if (raw === 'all' || raw === 'errors' || raw === 'slow' || raw === 'none') return raw;
    return 'errors';
}

function readSlowMs(): number {
    const raw = process.env['LOG_HTTP_SLOW_MS'];
    if (!raw) return 1000;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 1000;
}

export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
    const mode = readLogHttpMode();
    if (mode === 'none') {
        next();
        return;
    }

    const startMs = Date.now();
    const slowMs = readSlowMs();

    _res.on('finish', () => {
        const durationMs = Date.now() - startMs;
        const status = _res.statusCode;

        const isError = status >= 400;
        const isSlow = durationMs >= slowMs;

        if (mode === 'errors' && !isError) return;
        if (mode === 'slow' && !(isError || isSlow)) return;

        const timestamp = new Date().toISOString();
        const path = req.originalUrl || req.url || req.path;
        console.log(`[${timestamp}] ${req.method} ${path} ${status} ${durationMs}ms`);
    });

    next();
}
