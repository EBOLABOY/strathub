/**
 * Exchange/Network errors (shared)
 *
 * 目标：让上层（worker/api）能基于 code/retryable 做稳定判断，
 * 而不是靠 message 字符串猜。
 */

export type ExchangeErrorCode =
    | 'RATE_LIMIT'
    | 'TIMEOUT'
    | 'EXCHANGE_UNAVAILABLE'
    | 'DUPLICATE_ORDER'
    | 'AUTH'
    | 'BAD_REQUEST'
    | 'UNKNOWN';

export class ExchangeError extends Error {
    public readonly code: ExchangeErrorCode;
    public readonly retryable: boolean;
    public readonly retryAfterMs?: number;

    constructor(
        message: string,
        code: ExchangeErrorCode,
        retryable: boolean,
        retryAfterMs?: number,
        cause?: unknown
    ) {
        super(message, cause ? { cause } : undefined);
        this.name = 'ExchangeError';
        this.code = code;
        this.retryable = retryable;
        this.retryAfterMs = retryAfterMs;
    }
}

export class RateLimitError extends ExchangeError {
    constructor(retryAfterMs?: number, cause?: unknown) {
        super(
            `Rate limit exceeded${retryAfterMs ? `, retry after ${retryAfterMs}ms` : ''}`,
            'RATE_LIMIT',
            true,
            retryAfterMs,
            cause
        );
        this.name = 'RateLimitError';
    }
}

export class TimeoutError extends ExchangeError {
    constructor(message = 'Request timeout', cause?: unknown) {
        super(message, 'TIMEOUT', true, undefined, cause);
        this.name = 'TimeoutError';
    }
}

export class ExchangeUnavailableError extends ExchangeError {
    constructor(message = 'Exchange unavailable', cause?: unknown) {
        super(message, 'EXCHANGE_UNAVAILABLE', true, undefined, cause);
        this.name = 'ExchangeUnavailableError';
    }
}

export class DuplicateOrderError extends ExchangeError {
    constructor(clientOrderId: string, cause?: unknown) {
        super(`Duplicate clientOrderId: ${clientOrderId}`, 'DUPLICATE_ORDER', false, undefined, cause);
        this.name = 'DuplicateOrderError';
    }
}
