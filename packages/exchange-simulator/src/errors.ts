/**
 * Simulator Errors
 */

import type { FaultMode } from './types.js';

export class SimulatorError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly retryable: boolean = false,
        public readonly retryAfterMs?: number
    ) {
        super(message);
        this.name = 'SimulatorError';
    }
}

export class TimeoutError extends SimulatorError {
    constructor(endpoint: string) {
        super(`Request timeout: ${endpoint}`, 'TIMEOUT', true);
        this.name = 'TimeoutError';
    }
}

export class RateLimitError extends SimulatorError {
    constructor(retryAfterMs?: number) {
        super(
            `Rate limit exceeded${retryAfterMs ? `, retry after ${retryAfterMs}ms` : ''}`,
            'RATE_LIMIT',
            true,
            retryAfterMs
        );
        this.name = 'RateLimitError';
    }
}

export class AuthError extends SimulatorError {
    constructor(message = 'Authentication failed') {
        super(message, 'AUTH', false);
        this.name = 'AuthError';
    }
}

export class BadRequestError extends SimulatorError {
    constructor(message: string) {
        super(message, 'BAD_REQUEST', false);
        this.name = 'BadRequestError';
    }
}

export class DuplicateOrderError extends SimulatorError {
    constructor(clientOrderId: string) {
        super(`Duplicate clientOrderId: ${clientOrderId}`, 'DUPLICATE_ORDER', false);
        this.name = 'DuplicateOrderError';
    }
}

export class OrderNotFoundError extends SimulatorError {
    constructor(orderId: string) {
        super(`Order not found: ${orderId}`, 'ORDER_NOT_FOUND', false);
        this.name = 'OrderNotFoundError';
    }
}

export class InsufficientFundsError extends SimulatorError {
    constructor(asset: string, required: string, available: string) {
        super(
            `Insufficient ${asset}: required ${required}, available ${available}`,
            'INSUFFICIENT_FUNDS',
            false
        );
        this.name = 'InsufficientFundsError';
    }
}

/**
 * 根据 FaultMode 创建对应的错误
 */
export function createFaultError(mode: FaultMode, endpoint: string, retryAfterMs?: number): SimulatorError {
    switch (mode) {
        case 'timeout':
            return new TimeoutError(endpoint);
        case 'rateLimit':
            return new RateLimitError(retryAfterMs);
        case 'auth':
            return new AuthError();
        case 'badRequest':
            return new BadRequestError(`Bad request on ${endpoint}`);
        default:
            return new SimulatorError(`Unknown fault: ${mode}`, 'UNKNOWN');
    }
}
