import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BinanceExecutor } from '../src/binance-executor.js';
import { ORDER_PREFIX } from '@crypto-strategy-hub/shared';

// Mock ccxt
const mockCreateOrder = vi.fn();
const mockFetchOpenOrders = vi.fn();
const mockFetchMyTrades = vi.fn();
const mockCancelOrder = vi.fn();
const mockFetchOrder = vi.fn();
const mockPrivateGetOrder = vi.fn();
const mockMarket = vi.fn();
const mockParseOrder = vi.fn();

vi.mock('ccxt', () => {
    return {
        default: {
            binance: class {
                createOrder = mockCreateOrder;
                fetchOpenOrders = mockFetchOpenOrders;
                fetchMyTrades = mockFetchMyTrades;
                cancelOrder = mockCancelOrder;
                fetchOrder = mockFetchOrder;
                market = mockMarket;
                parseOrder = mockParseOrder;
                setSandboxMode = vi.fn();
                privateGetOrder = mockPrivateGetOrder;
            }
        }
    };
});

describe('BinanceExecutor', () => {
    let executor: BinanceExecutor;
    const config = { apiKey: 'k', secret: 's', isTestnet: true };

    beforeEach(() => {
        vi.clearAllMocks();
        executor = new BinanceExecutor(config);
    });

    it('should create order successfully', async () => {
        mockCreateOrder.mockResolvedValue({ id: '123', status: 'NEW' });

        const result = await executor.createOrder({
            symbol: 'BNB/USDT',
            type: 'limit',
            side: 'buy',
            price: '100',
            amount: '1',
            clientOrderId: `${ORDER_PREFIX}-test-1`
        });

        expect(result.exchangeOrderId).toBe('123');
        expect(mockCreateOrder).toHaveBeenCalledWith(
            'BNB/USDT', 'limit', 'buy', 1, 100, { newClientOrderId: expect.stringContaining(ORDER_PREFIX) }
        );
    });

    it('should handle duplicate order error (idempotency)', async () => {
        // First call throws duplicate error
        const err = new Error('Duplicate order');
        mockCreateOrder.mockRejectedValue(err);

        // Mock lookup response
        mockMarket.mockReturnValue({ id: 'BNBUSDT' });
        mockPrivateGetOrder.mockResolvedValue({ orderId: 123, status: 'FILLED' }); // Raw binance
        mockParseOrder.mockReturnValue({ id: '123', status: 'FILLED' });

        const result = await executor.createOrder({
            symbol: 'BNB/USDT',
            type: 'limit',
            side: 'buy',
            price: '100',
            amount: '1',
            clientOrderId: `${ORDER_PREFIX}-test-1`
        });

        expect(result.exchangeOrderId).toBe('123');
        expect(result.status).toBe('FILLED');
        expect(mockPrivateGetOrder).toHaveBeenCalled();
    });

    it('should filter open orders', async () => {
        mockFetchOpenOrders.mockResolvedValue([
            { id: '1', clientOrderId: `${ORDER_PREFIX}-1`, symbol: 'BNB/USDT' },
            { id: '2', clientOrderId: 'other-bot', symbol: 'BTC/USDT' }
        ]);

        const orders = await executor.fetchOpenOrders('BNB/USDT');
        expect(orders).toHaveLength(1);
        expect(orders[0].id).toBe('1');
    });

    it('should return all trades (filtering moved to reconcile layer)', async () => {
        mockFetchMyTrades.mockResolvedValue([
            { id: 't1', info: { clientOrderId: `${ORDER_PREFIX}-1` }, price: 100, amount: 1 },
            { id: 't2', info: { clientOrderId: 'other' }, price: 200, amount: 2 },
            { id: 't3', info: {}, price: 300, amount: 3 }
        ]);

        const trades = await executor.fetchMyTrades('BNB/USDT');
        expect(trades).toHaveLength(3);
    });

    it('should create market order with undefined price', async () => {
        mockCreateOrder.mockResolvedValue({ id: 'market1', status: 'NEW' });

        await executor.createOrder({
            symbol: 'BNB/USDT',
            type: 'market',
            side: 'buy',
            price: '0', // Should be ignored
            amount: '1',
            clientOrderId: `${ORDER_PREFIX}-market-1`
        });

        expect(mockCreateOrder).toHaveBeenCalledWith(
            'BNB/USDT', 'market', 'buy', 1, undefined, { newClientOrderId: expect.stringContaining(ORDER_PREFIX) }
        );
    });
});
