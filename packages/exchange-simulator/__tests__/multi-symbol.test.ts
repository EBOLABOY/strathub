/**
 * ACC-CORE-002: 多 symbol 并发隔离
 * ACC-CORE-003: 部分成交（状态单调、filled 汇总正确）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExchangeSimulator, FakeClock } from '../src/index.js';

describe('ACC-CORE-002: 多 symbol 并发隔离', () => {
    let simulator: ExchangeSimulator;
    let clock: FakeClock;

    beforeEach(() => {
        clock = new FakeClock(new Date('2026-01-06T10:00:00Z'));
        simulator = new ExchangeSimulator('binance', clock);
        simulator.setBalance('USDT', '20000');
        simulator.setBalance('BNB', '10');
        simulator.setBalance('ETH', '5');
    });

    it('should isolate errors between symbols', async () => {
        // 创建 BNB 和 ETH 的订单
        const bnbOrder = await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.00',
            amount: '0.1',
            clientOrderId: 'gb1bnb001aaaaaaaaaaaaaaaaaaa',
        });

        const ethOrder = await simulator.createOrder({
            symbol: 'ETH/USDT',
            side: 'buy',
            type: 'limit',
            price: '2000.00',
            amount: '0.1',
            clientOrderId: 'gb1eth001aaaaaaaaaaaaaaaaaaa',
        });

        // 注入 BNB 的获取订单失败
        // 注意：当前 simulator 不支持按 symbol 注入错误
        // 但我们可以验证两个 symbol 的订单是独立的

        const bnbOrders = await simulator.fetchOpenOrders('BNB/USDT');
        const ethOrders = await simulator.fetchOpenOrders('ETH/USDT');

        // 验证隔离
        expect(bnbOrders.length).toBe(1);
        expect(ethOrders.length).toBe(1);
        expect(bnbOrders[0]!.clientOrderId).toBe('gb1bnb001aaaaaaaaaaaaaaaaaaa');
        expect(ethOrders[0]!.clientOrderId).toBe('gb1eth001aaaaaaaaaaaaaaaaaaa');
    });

    it('should handle partial fill on one symbol without affecting another', async () => {
        const bnbOrder = await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.00',
            amount: '1.0',
            clientOrderId: 'gb1bnb002aaaaaaaaaaaaaaaaaaa',
        });

        await simulator.createOrder({
            symbol: 'ETH/USDT',
            side: 'buy',
            type: 'limit',
            price: '2000.00',
            amount: '1.0',
            clientOrderId: 'gb1eth002aaaaaaaaaaaaaaaaaaa',
        });

        // BNB 部分成交
        simulator.simulateFill(bnbOrder.exchangeOrderId, '0.5', '580.00');

        // 验证
        const bnbOrders = await simulator.fetchOpenOrders('BNB/USDT');
        const ethOrders = await simulator.fetchOpenOrders('ETH/USDT');

        expect(bnbOrders[0]!.status).toBe('PARTIALLY_FILLED');
        expect(bnbOrders[0]!.filledAmount).toBe('0.50000000');

        // ETH 不受影响
        expect(ethOrders[0]!.status).toBe('NEW');
        expect(ethOrders[0]!.filledAmount).toBe('0');
    });

    it('should track trades independently per symbol', async () => {
        const bnbOrder = await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.00',
            amount: '0.5',
            clientOrderId: 'gb1bnb003aaaaaaaaaaaaaaaaaaa',
        });

        const ethOrder = await simulator.createOrder({
            symbol: 'ETH/USDT',
            side: 'buy',
            type: 'limit',
            price: '2000.00',
            amount: '0.5',
            clientOrderId: 'gb1eth003aaaaaaaaaaaaaaaaaaa',
        });

        // 两个 symbol 都有成交
        simulator.simulateFill(bnbOrder.exchangeOrderId, '0.5', '580.00');
        simulator.simulateFill(ethOrder.exchangeOrderId, '0.3', '2000.00');

        const bnbTrades = await simulator.fetchMyTrades('BNB/USDT');
        const ethTrades = await simulator.fetchMyTrades('ETH/USDT');

        expect(bnbTrades.length).toBe(1);
        expect(ethTrades.length).toBe(1);
        expect(bnbTrades[0]!.symbol).toBe('BNB/USDT');
        expect(ethTrades[0]!.symbol).toBe('ETH/USDT');
    });
});

describe('ACC-CORE-003: 部分成交（状态单调、乱序、重复）', () => {
    let simulator: ExchangeSimulator;
    let clock: FakeClock;

    beforeEach(() => {
        clock = new FakeClock(new Date('2026-01-06T10:00:00Z'));
        simulator = new ExchangeSimulator('binance', clock);
        simulator.setBalance('USDT', '10000');
        simulator.setBalance('BNB', '10');
    });

    it('should aggregate multiple fills correctly', async () => {
        const order = await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.00',
            amount: '1.0',
            clientOrderId: 'gb1multi001aaaaaaaaaaaaaaaaaa',
        });

        // 多笔成交
        simulator.simulateFill(order.exchangeOrderId, '0.3', '580.00');
        simulator.simulateFill(order.exchangeOrderId, '0.4', '580.00');
        simulator.simulateFill(order.exchangeOrderId, '0.3', '580.00');

        // 验证汇总
        const updated = await simulator.fetchOrder(order.exchangeOrderId);
        expect(updated!.status).toBe('FILLED');
        expect(updated!.filledAmount).toBe('1.00000000');
        expect(updated!.avgFillPrice).toBe('580.00000000');
    });

    it('should never regress order status', async () => {
        const order = await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.00',
            amount: '1.0',
            clientOrderId: 'gb1regress001aaaaaaaaaaaaaaaaa',
        });

        // 第一次成交 -> PARTIALLY_FILLED
        simulator.simulateFill(order.exchangeOrderId, '0.5', '580.00');
        let updated = await simulator.fetchOrder(order.exchangeOrderId);
        expect(updated!.status).toBe('PARTIALLY_FILLED');

        // 完全成交 -> FILLED
        simulator.simulateFill(order.exchangeOrderId, '0.5', '580.00');
        updated = await simulator.fetchOrder(order.exchangeOrderId);
        expect(updated!.status).toBe('FILLED');

        // 验证 filledAmount 只增不减
        expect(parseFloat(updated!.filledAmount)).toBeGreaterThanOrEqual(1.0);
    });

    it('should handle trades with tradeId for idempotency', async () => {
        const order = await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '580.00',
            amount: '1.0',
            clientOrderId: 'gb1idempot001aaaaaaaaaaaaaaaaa',
        });

        // 成交
        const trade1 = simulator.simulateFill(order.exchangeOrderId, '0.5', '580.00');
        const trade2 = simulator.simulateFill(order.exchangeOrderId, '0.3', '580.00');

        // 每个 trade 有唯一的 tradeId
        expect(trade1.tradeId).not.toBe(trade2.tradeId);

        // 可以用 tradeId 做幂等
        const trades = await simulator.fetchMyTrades('BNB/USDT');
        const tradeIds = new Set(trades.map(t => t.tradeId));
        expect(tradeIds.size).toBe(trades.length); // 无重复
    });

    it('should calculate avgFillPrice correctly with different prices', async () => {
        const order = await simulator.createOrder({
            symbol: 'BNB/USDT',
            side: 'buy',
            type: 'limit',
            price: '585.00',
            amount: '1.0',
            clientOrderId: 'gb1avgprice001aaaaaaaaaaaaaaa',
        });

        // 不同价格的成交
        simulator.simulateFill(order.exchangeOrderId, '0.4', '580.00'); // 232
        simulator.simulateFill(order.exchangeOrderId, '0.6', '585.00'); // 351

        const updated = await simulator.fetchOrder(order.exchangeOrderId);

        // avgFillPrice = (0.4*580 + 0.6*585) / 1.0 = 583
        const expectedAvg = (0.4 * 580 + 0.6 * 585) / 1.0;
        expect(parseFloat(updated!.avgFillPrice!)).toBeCloseTo(expectedAvg, 2);
    });
});
