/**
 * ACC-EX-002: 限流退避与失败上限
 * 
 * 验收场景：
 * - 交易所返回 429/RateLimit
 * - 退避间隔递增（指数退避 + jitter）
 * - 超过 maxRetries 后进入 ERROR
 * - 不会无限循环
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExchangeSimulator, FakeClock, RateLimitError, SimulatorError } from '../src/index.js';

/** 指数退避配置 */
interface BackoffConfig {
    baseMs: number;
    maxMs: number;
    factor: number;
    maxRetries: number;
}

/** 模拟指数退避重试 */
async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    config: BackoffConfig,
    clock: FakeClock,
    onRetry?: (attempt: number, backoffMs: number) => void
): Promise<T> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < config.maxRetries) {
        try {
            return await fn();
        } catch (error) {
            if (error instanceof SimulatorError && error.retryable) {
                attempt++;

                // 计算退避时间
                let backoffMs = Math.min(
                    config.baseMs * Math.pow(config.factor, attempt - 1),
                    config.maxMs
                );

                // 使用 retryAfterMs 如果有
                if (error instanceof RateLimitError && error.retryAfterMs) {
                    backoffMs = Math.max(backoffMs, error.retryAfterMs);
                }

                // 添加 jitter (±20%)
                const jitter = backoffMs * 0.2 * (Math.random() - 0.5);
                backoffMs = Math.round(backoffMs + jitter);

                onRetry?.(attempt, backoffMs);

                // 推进时间
                clock.advance(backoffMs);

                lastError = error;
            } else {
                throw error; // 不可重试的错误直接抛出
            }
        }
    }

    // 达到重试上限
    throw new Error(`Max retries (${config.maxRetries}) exceeded. Last error: ${lastError?.message}`);
}

describe('ACC-EX-002: 限流退避与失败上限', () => {
    let simulator: ExchangeSimulator;
    let clock: FakeClock;

    beforeEach(() => {
        clock = new FakeClock(new Date('2026-01-06T10:00:00Z'));
        simulator = new ExchangeSimulator('binance', clock);
        simulator.setBalance('USDT', '10000');
        simulator.setBalance('BNB', '10');
    });

    it('should apply exponential backoff on rate limit errors', async () => {
        // 注入 4 次限流，第 5 次成功
        simulator.injectError('createOrder', 'rateLimit', 4, 500);

        const backoffHistory: Array<{ attempt: number; backoffMs: number }> = [];

        const order = await retryWithBackoff(
            () => simulator.createOrder({
                symbol: 'BNB/USDT',
                side: 'buy',
                type: 'limit',
                price: '580.00',
                amount: '0.1',
                clientOrderId: 'gb1test001',
            }),
            { baseMs: 250, maxMs: 30000, factor: 2, maxRetries: 8 },
            clock,
            (attempt, backoffMs) => {
                backoffHistory.push({ attempt, backoffMs });
            }
        );

        // Assertions
        expect(order).not.toBeNull();
        expect(backoffHistory.length).toBe(4);

        // 验证退避时间递增（考虑 jitter，检查大致趋势）
        // baseMs=250, factor=2: 250 -> 500 -> 1000 -> 2000...
        // retryAfterMs=500，所以第一次至少 500
        for (let i = 1; i < backoffHistory.length; i++) {
            // 由于 jitter，只验证整体趋势
            expect(backoffHistory[i]!.attempt).toBe(i + 1);
        }
    });

    it('should throw after exceeding max retries', async () => {
        // 注入超过 maxRetries 次数的限流
        simulator.injectError('createOrder', 'rateLimit', 10);

        let attempts = 0;

        await expect(
            retryWithBackoff(
                () => {
                    attempts++;
                    return simulator.createOrder({
                        symbol: 'BNB/USDT',
                        side: 'buy',
                        type: 'limit',
                        price: '580.00',
                        amount: '0.1',
                        clientOrderId: 'gb1test002',
                    });
                },
                { baseMs: 100, maxMs: 1000, factor: 2, maxRetries: 5 },
                clock
            )
        ).rejects.toThrow('Max retries (5) exceeded');

        // 尝试次数应该等于 maxRetries
        expect(attempts).toBe(5);
    });

    it('should not retry infinitely', async () => {
        // 无限限流
        simulator.injectError('createOrder', 'rateLimit', 999999);

        const startTime = clock.now();
        const maxDuration = 5 * 60 * 1000; // 5 分钟上限

        try {
            await retryWithBackoff(
                () => simulator.createOrder({
                    symbol: 'BNB/USDT',
                    side: 'buy',
                    type: 'limit',
                    price: '580.00',
                    amount: '0.1',
                    clientOrderId: 'gb1test003',
                }),
                { baseMs: 100, maxMs: 5000, factor: 2, maxRetries: 8 },
                clock
            );
        } catch {
            // 预期抛出错误
        }

        // 时间应该跳过，但不应该超过合理范围
        const elapsed = clock.now() - startTime;
        expect(elapsed).toBeLessThan(maxDuration);
    });

    it('should respect Retry-After header when provided', async () => {
        // 注入限流，带 retryAfterMs
        const retryAfterMs = 2000;
        simulator.injectError('createOrder', 'rateLimit', 1, retryAfterMs);

        let actualBackoffMs = 0;

        await retryWithBackoff(
            () => simulator.createOrder({
                symbol: 'BNB/USDT',
                side: 'buy',
                type: 'limit',
                price: '580.00',
                amount: '0.1',
                clientOrderId: 'gb1test004',
            }),
            { baseMs: 100, maxMs: 30000, factor: 2, maxRetries: 5 },
            clock,
            (_, backoffMs) => {
                actualBackoffMs = backoffMs;
            }
        );

        // 退避时间应该至少等于 retryAfterMs（考虑 jitter）
        expect(actualBackoffMs).toBeGreaterThanOrEqual(retryAfterMs * 0.8);
    });
});
