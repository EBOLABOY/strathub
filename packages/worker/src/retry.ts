/**
 * Retry/Backoff utilities (V1)
 *
 * V1 目标是“可靠性骨架”，不是复杂的分布式调度：
 * - 单实例 worker 假设成立（见 worker.ts 头注释）
 * - 退避状态保存在进程内（重启会重置），但幂等键保证不会重复下单
 */

export interface BackoffOptions {
    baseMs: number;
    maxMs: number;
    jitterRatio: number; // e.g. 0.2 => +/-10%
}

export interface RetryableErrorInfo {
    retryable: boolean;
    isRateLimit: boolean;
    retryAfterMs?: number;
    code?: string;
    message: string;
}

export function computeBackoffMs(
    attempt: number,
    options: BackoffOptions,
    retryAfterMs?: number
): number {
    const safeAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
    const exp = Math.min(options.maxMs, options.baseMs * Math.pow(2, safeAttempt - 1));

    const jitter = exp * options.jitterRatio * (Math.random() - 0.5);
    let backoffMs = Math.round(exp + jitter);

    if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
        backoffMs = Math.max(backoffMs, Math.round(retryAfterMs));
    }

    return Math.max(0, backoffMs);
}

function readNumberProp(value: unknown, key: string): number | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw !== 'number') return undefined;
    if (!Number.isFinite(raw)) return undefined;
    return raw;
}

function readStringProp(value: unknown, key: string): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const raw = (value as Record<string, unknown>)[key];
    return typeof raw === 'string' ? raw : undefined;
}

export function classifyRetryableError(error: unknown): RetryableErrorInfo {
    const message = error instanceof Error ? error.message : String(error);
    const code = readStringProp(error, 'code');

    // ExchangeSimulator 的错误模型：{ retryable: boolean; retryAfterMs?: number; code: string }
    const retryableFlag = (() => {
        if (!error || typeof error !== 'object') return undefined;
        const raw = (error as Record<string, unknown>)['retryable'];
        return typeof raw === 'boolean' ? raw : undefined;
    })();
    const retryAfterMs = readNumberProp(error, 'retryAfterMs') ?? readNumberProp(error, 'retryAfter');

    const isRateLimit =
        code === 'RATE_LIMIT' ||
        (error instanceof Error && error.name === 'RateLimitError') ||
        /rate\s*limit|too\s*many\s*requests|429/i.test(message);

    const isTimeout =
        code === 'TIMEOUT' ||
        (error instanceof Error && /timeout|timed\s*out|ETIMEDOUT/i.test(message));

    const isTransient =
        code === 'EXCHANGE_UNAVAILABLE' ||
        /EXCHANGE_UNAVAILABLE|service\s+unavailable|temporarily\s+unavailable|unavailable|503|network/i.test(message) ||
        /ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN/i.test(message);

    const retryable =
        retryableFlag === true ||
        isRateLimit ||
        isTimeout ||
        isTransient;

    return {
        retryable,
        isRateLimit,
        retryAfterMs,
        code,
        message,
    };
}
