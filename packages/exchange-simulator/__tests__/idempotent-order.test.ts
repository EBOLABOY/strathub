/**
 * ACC-EX-001: 网络错误 + 幂等下单
 * 
 * 验收场景：
 * - createOrder() 前 N 次超时/连接失败，第 N+1 次成功
 * - 只存在 1 个 clientOrderId 对应的订单
 * - 重启后不重复下单
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExchangeSimulator, FakeClock, TimeoutError } from '../src/index.js';
import { generateClientOrderId, ORDER_PREFIX } from '@crypto-strategy-hub/shared';

// 使用固定的 botId 模拟测试（长度 >= 8）
const TEST_BOT_ID = 'test-bot-001';

describe('ACC-EX-001: 网络错误 + 幂等下单', () => {
    let simulator: ExchangeSimulator;
    let clock: FakeClock;

    beforeEach(() => {
        clock = new FakeClock(new Date('2026-01-06T10:00:00Z'));
        simulator = new ExchangeSimulator('binance', clock);

        // 设置初始余额
        simulator.setBalance('USDT', '10000');
        simulator.setBalance('BNB', '10');

        // 设置市场数据
        simulator.setTicker('BNB/USDT', '580.50');
    });

    it('should retry on timeout and eventually succeed with same clientOrderId', async () => {
        // 注入 3 次超时，第 4 次成功
        simulator.injectError('createOrder', 'timeout', 3);

        const clientOrderId = generateClientOrderId(TEST_BOT_ID, 1);

        let retryAttempt = 0;
        let order = null;

        // 模拟重试逻辑
        while (retryAttempt < 5) {
            try {
                order = await simulator.createOrder({
                    symbol: 'BNB/USDT',
                    side: 'buy',
                    type: 'limit',
                    price: '580.50',
                    amount: '0.1000',
                    clientOrderId,
                });
                break; // 成功则退出
            } catch (error) {
                if (error instanceof TimeoutError) {
                    retryAttempt++;
                    clock.advance(Math.pow(2, retryAttempt) * 250); // 指数退避
                } else {
                    throw error;
                }
            }
        }

        // Assertions
        expect(retryAttempt).toBe(3); // 重试了 3 次
        expect(order).not.toBeNull();
        expect(order!.clientOrderId).toBe(clientOrderId);
        expect(simulator.getOrderCount()).toBe(1); // 只有 1 个订单
    });

    it('should return same order when createOrder is called with duplicate clientOrderId', async () => {
        const clientOrderId = generateClientOrderId(TEST_BOT_ID, 2);

        // 第一次创建
        const order1 = await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.50',
            amount: '0.2000',
            clientOrderId,
        });

        // 第二次创建（相同 clientOrderId）
        const order2 = await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.50',
            amount: '0.2000',
            clientOrderId,
        });

        // Assertions: 幂等，返回同一订单
        expect(order1.exchangeOrderId).toBe(order2.exchangeOrderId);
        expect(order1.clientOrderId).toBe(order2.clientOrderId);
        expect(simulator.getOrderCount()).toBe(1);
    });

    it('should not create duplicate order after simulated restart', async () => {
        const clientOrderId = generateClientOrderId(TEST_BOT_ID, 3);

        // 创建订单
        const order = await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.50',
            amount: '0.3000',
            clientOrderId,
        });

        // 模拟"重启"后 reconcile：先查询已有订单
        const existingOrder = await simulator.fetchOrderByClientOrderId('BNB/USDT', clientOrderId);

        // 如果已存在，不应该再创建新订单
        expect(existingOrder).not.toBeNull();
        expect(existingOrder!.exchangeOrderId).toBe(order.exchangeOrderId);

        // 即使再次调用 createOrder，也应该返回同一订单（幂等）
        const orderAgain = await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.50',
            amount: '0.3000',
            clientOrderId,
        });

        expect(orderAgain.exchangeOrderId).toBe(order.exchangeOrderId);
        expect(simulator.getOrderCount()).toBe(1);
    });

    it('should use clientOrderId with gb1 prefix for identification', async () => {
        const clientOrderId = generateClientOrderId(TEST_BOT_ID, 4);

        // 验证 clientOrderId 格式
        expect(clientOrderId).toMatch(new RegExp(`^${ORDER_PREFIX}-[a-z0-9]{8}-\\d+$`));
        expect(clientOrderId.startsWith(ORDER_PREFIX)).toBe(true);

        const order = await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'sell',
            type: 'limit',
            price: '590.00',
            amount: '0.5000',
            clientOrderId,
        });

        // 验证可通过 clientOrderId 识别"我方订单"
        expect(order.clientOrderId.startsWith('gb1')).toBe(true);
    });
});
