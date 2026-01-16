import ccxt from 'ccxt';
import {
    AuthError,
    BadRequestError,
    ExchangeUnavailableError,
    RateLimitError,
    TimeoutError,
} from '@crypto-strategy-hub/shared';

export function logCcxtError(tag: string, operation: string, error: unknown): void {
    const prefix = tag ? `[${tag}]` : '[Ccxt]';

    if (error instanceof ccxt.AuthenticationError) {
        console.error(`${prefix} AUTH_FAILED in ${operation}:`, (error as Error).message);
        return;
    }
    if (error instanceof ccxt.NetworkError) {
        console.error(`${prefix} NETWORK_ERROR in ${operation}:`, (error as Error).message);
        return;
    }
    if (error instanceof ccxt.RateLimitExceeded) {
        console.error(`${prefix} RATE_LIMIT in ${operation}:`, (error as Error).message);
        return;
    }
    if (error instanceof ccxt.InvalidOrder) {
        console.error(`${prefix} INVALID_ORDER in ${operation}:`, (error as Error).message);
        return;
    }
    console.error(`${prefix} ERROR in ${operation}:`, error);
}

export function isLikelyDuplicateClientOrderIdError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
        /duplicate/i.test(message) ||
        /already\s+exists/i.test(message) ||
        /client.?order.?id/i.test(message) && /exists|used|duplicate/i.test(message)
    );
}

export function mapCcxtError(operation: string, error: unknown, symbol?: string): unknown {
    if (error instanceof ccxt.RateLimitExceeded || error instanceof ccxt.DDoSProtection) {
        return new RateLimitError(undefined, error);
    }
    if (error instanceof ccxt.RequestTimeout) {
        return new TimeoutError(`Request timeout: ${operation}${symbol ? ` (${symbol})` : ''}`, error);
    }
    if (error instanceof ccxt.NetworkError || error instanceof ccxt.ExchangeNotAvailable) {
        return new ExchangeUnavailableError(`Exchange unavailable: ${operation}${symbol ? ` (${symbol})` : ''}`, error);
    }
    if (error instanceof ccxt.AuthenticationError) {
        return new AuthError(`Exchange auth failed: ${operation}${symbol ? ` (${symbol})` : ''}`, error);
    }
    if (error instanceof ccxt.InvalidOrder || error instanceof ccxt.BadRequest || error instanceof ccxt.InsufficientFunds) {
        return new BadRequestError(`Exchange rejected request: ${operation}${symbol ? ` (${symbol})` : ''}`, error);
    }

    return error;
}
