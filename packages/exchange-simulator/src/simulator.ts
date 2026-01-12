/**
 * ExchangeSimulator - 可控的交易所模拟器
 * 
 * 用于集成测试，支持：
 * - 幂等下单（同一 clientOrderId 返回同一订单）
 * - 错误注入（timeout/rateLimit/auth/badRequest）
 * - 部分成交模拟
 * 
 * 来源：implementation_plan.md §2.5.1
 */

import type { DecimalString, OrderStatus } from '@crypto-strategy-hub/shared';
import type {
    FaultEndpoint,
    FaultMode,
    FaultInjection,
    OHLCV,
    OrderBook,
    Ticker,
    SimulatorBalance,
    SimulatorOrder,
    SimulatorTrade,
} from './types.js';
import {
    createFaultError,
    DuplicateOrderError,
    OrderNotFoundError,
    InsufficientFundsError,
} from './errors.js';
import { FakeClock } from './fake-clock.js';

export interface CreateOrderParams {
    symbol: string;
    side: 'buy' | 'sell';
    type: 'limit' | 'market';
    price?: DecimalString;
    amount: DecimalString;
    clientOrderId: string;
}

export class ExchangeSimulator {
    private readonly exchange: string;
    private readonly clock: FakeClock;

    // Market Data
    private tickers: Map<string, Ticker> = new Map();
    private orderBooks: Map<string, OrderBook> = new Map();
    private ohlcvData: Map<string, OHLCV[]> = new Map(); // key: symbol:timeframe

    // Account
    private balances: Map<string, SimulatorBalance> = new Map();

    // Orders & Trades
    private orders: Map<string, SimulatorOrder> = new Map(); // key: exchangeOrderId
    private ordersByClientId: Map<string, SimulatorOrder> = new Map(); // key: clientOrderId
    private trades: SimulatorTrade[] = [];
    private nextOrderId = 1;
    private nextTradeId = 1;

    // Fault Injection
    private faults: Map<FaultEndpoint, FaultInjection> = new Map();

    // Config
    private readonly defaultFeeRate = '0.001'; // 0.1%

    constructor(exchange = 'binance', clock?: FakeClock) {
        this.exchange = exchange;
        this.clock = clock ?? new FakeClock();
    }

    // ============================================================================
    // Clock Access
    // ============================================================================

    getClock(): FakeClock {
        return this.clock;
    }

    // ============================================================================
    // Market Data
    // ============================================================================

    setTicker(symbol: string, last: DecimalString): void {
        this.tickers.set(symbol, {
            symbol,
            last,
            timestamp: this.clock.now(),
        });
    }

    async fetchTicker(symbol: string): Promise<Ticker | null> {
        return this.tickers.get(symbol) ?? null;
    }

    setOrderBook(symbol: string, bids: DecimalString[], asks: DecimalString[]): void {
        this.orderBooks.set(symbol, {
            bids: bids.map((price, i) => ({ price, amount: '1.0' })),
            asks: asks.map((price, i) => ({ price, amount: '1.0' })),
            timestamp: this.clock.now(),
        });
    }

    async fetchOrderBook(symbol: string): Promise<OrderBook | null> {
        return this.orderBooks.get(symbol) ?? null;
    }

    setOHLCV(symbol: string, timeframe: string, candles: OHLCV[]): void {
        const key = `${symbol}:${timeframe}`;
        this.ohlcvData.set(key, candles);
    }

    async fetchOHLCV(symbol: string, timeframe: string): Promise<OHLCV[]> {
        this.checkFault('fetchOHLCV');
        const key = `${symbol}:${timeframe}`;
        return this.ohlcvData.get(key) ?? [];
    }

    // ============================================================================
    // Account
    // ============================================================================

    setBalance(asset: string, free: DecimalString, locked: DecimalString = '0'): void {
        this.balances.set(asset, { free, locked });
    }

    async fetchBalance(): Promise<Map<string, SimulatorBalance>> {
        this.checkFault('fetchBalance');
        return new Map(this.balances);
    }

    // ============================================================================
    // Orders（核心：幂等行为）
    // ============================================================================

    async createOrder(params: CreateOrderParams): Promise<SimulatorOrder> {
        this.checkFault('createOrder');

        const { symbol, side, type, price, amount, clientOrderId } = params;

        // 幂等检查：同一 clientOrderId 返回已存在的订单
        const existingOrder = this.ordersByClientId.get(clientOrderId);
        if (existingOrder) {
            // 可选行为：返回同一订单（推荐）
            // 或抛出 DuplicateOrderError（让调用方走 fetch 流程）
            return existingOrder;
        }

        // 余额检查（简化版）
        const [base, quote] = this.parseSymbol(symbol);
        if (side === 'buy') {
            const quoteBalance = this.balances.get(quote);
            const required = type === 'limit' && price
                ? (parseFloat(amount) * parseFloat(price)).toFixed(8)
                : amount;
            if (!quoteBalance || parseFloat(quoteBalance.free) < parseFloat(required)) {
                throw new InsufficientFundsError(quote, required, quoteBalance?.free ?? '0');
            }
        } else {
            const baseBalance = this.balances.get(base);
            if (!baseBalance || parseFloat(baseBalance.free) < parseFloat(amount)) {
                throw new InsufficientFundsError(base, amount, baseBalance?.free ?? '0');
            }
        }

        // 创建订单
        const now = this.clock.nowISO();
        const exchangeOrderId = `${this.exchange}-${this.nextOrderId++}`;

        const order: SimulatorOrder = {
            exchangeOrderId,
            clientOrderId,
            symbol,
            side,
            type,
            status: 'NEW',
            price,
            amount,
            filledAmount: '0',
            createdAt: now,
            updatedAt: now,
        };

        this.orders.set(exchangeOrderId, order);
        this.ordersByClientId.set(clientOrderId, order);

        return order;
    }

    async cancelOrder(exchangeOrderId: string, symbol: string): Promise<SimulatorOrder> {
        this.checkFault('cancelOrder');

        const order = this.orders.get(exchangeOrderId);
        if (!order) {
            throw new OrderNotFoundError(exchangeOrderId);
        }

        if (order.status === 'FILLED' || order.status === 'CANCELED') {
            return order; // 幂等：已结束的订单直接返回
        }

        order.status = 'CANCELED';
        order.updatedAt = this.clock.nowISO();

        return order;
    }

    async fetchOpenOrders(symbol: string): Promise<SimulatorOrder[]> {
        this.checkFault('fetchOpenOrders');

        return Array.from(this.orders.values()).filter(
            o => o.symbol === symbol && (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED')
        );
    }

    async fetchOrderByClientOrderId(symbol: string, clientOrderId: string): Promise<SimulatorOrder | null> {
        const order = this.ordersByClientId.get(clientOrderId);
        if (order && order.symbol === symbol) {
            return order;
        }
        return null;
    }

    async fetchOrder(exchangeOrderId: string): Promise<SimulatorOrder | null> {
        return this.orders.get(exchangeOrderId) ?? null;
    }

    // ============================================================================
    // Trades
    // ============================================================================

    async fetchMyTrades(symbol: string, since?: string): Promise<SimulatorTrade[]> {
        this.checkFault('fetchMyTrades');

        let filtered = this.trades.filter(t => t.symbol === symbol);

        if (since) {
            const sinceTime = new Date(since).getTime();
            filtered = filtered.filter(t => new Date(t.timestamp).getTime() > sinceTime);
        }

        return filtered;
    }

    /**
     * 模拟成交（用于测试）
     */
    simulateFill(exchangeOrderId: string, amount: DecimalString, price: DecimalString): SimulatorTrade {
        const order = this.orders.get(exchangeOrderId);
        if (!order) {
            throw new OrderNotFoundError(exchangeOrderId);
        }

        const [base, quote] = this.parseSymbol(order.symbol);
        const fee = (parseFloat(amount) * parseFloat(price) * parseFloat(this.defaultFeeRate)).toFixed(8);

        const trade: SimulatorTrade = {
            tradeId: `${this.exchange}-trade-${this.nextTradeId++}`,
            orderId: exchangeOrderId,
            clientOrderId: order.clientOrderId,
            symbol: order.symbol,
            side: order.side,
            price,
            amount,
            fee,
            feeCurrency: quote,
            timestamp: this.clock.nowISO(),
        };

        this.trades.push(trade);

        // 更新余额（简化：只维护 free，不做 locked）
        const baseBalance = this.balances.get(base) ?? { free: '0', locked: '0' };
        const quoteBalance = this.balances.get(quote) ?? { free: '0', locked: '0' };

        const fillAmount = parseFloat(amount);
        const fillPrice = parseFloat(price);
        const notional = fillAmount * fillPrice;

        if (order.side === 'buy') {
            const availableQuote = parseFloat(quoteBalance.free);
            if (availableQuote < notional) {
                throw new InsufficientFundsError(quote, notional.toFixed(8), quoteBalance.free);
            }
            quoteBalance.free = (availableQuote - notional).toFixed(8);
            baseBalance.free = (parseFloat(baseBalance.free) + fillAmount).toFixed(8);
        } else {
            const availableBase = parseFloat(baseBalance.free);
            if (availableBase < fillAmount) {
                throw new InsufficientFundsError(base, amount, baseBalance.free);
            }
            baseBalance.free = (availableBase - fillAmount).toFixed(8);
            quoteBalance.free = (parseFloat(quoteBalance.free) + notional).toFixed(8);
        }

        this.balances.set(base, baseBalance);
        this.balances.set(quote, quoteBalance);

        // 更新订单状态
        const newFilledAmount = parseFloat(order.filledAmount) + parseFloat(amount);
        order.filledAmount = newFilledAmount.toFixed(8);

        // 计算平均成交价
        const trades = this.trades.filter(t => t.orderId === exchangeOrderId);
        let totalCost = 0;
        let totalAmount = 0;
        for (const t of trades) {
            totalAmount += parseFloat(t.amount);
            totalCost += parseFloat(t.amount) * parseFloat(t.price);
        }
        order.avgFillPrice = (totalCost / totalAmount).toFixed(8);

        // 更新状态
        if (newFilledAmount >= parseFloat(order.amount)) {
            order.status = 'FILLED';
        } else if (newFilledAmount > 0) {
            order.status = 'PARTIALLY_FILLED';
        }
        order.updatedAt = this.clock.nowISO();

        return trade;
    }

    // ============================================================================
    // Fault Injection
    // ============================================================================

    injectError(endpoint: FaultEndpoint, mode: FaultMode, count: number, retryAfterMs?: number): void {
        this.faults.set(endpoint, {
            endpoint,
            mode,
            remainingCount: count,
            retryAfterMs,
        });
    }

    clearFaults(): void {
        this.faults.clear();
    }

    private checkFault(endpoint: FaultEndpoint): void {
        const fault = this.faults.get(endpoint);
        if (fault && fault.remainingCount > 0) {
            fault.remainingCount--;
            if (fault.remainingCount === 0) {
                this.faults.delete(endpoint);
            }
            throw createFaultError(fault.mode, endpoint, fault.retryAfterMs);
        }
    }

    // ============================================================================
    // Reset
    // ============================================================================

    reset(): void {
        this.tickers.clear();
        this.orderBooks.clear();
        this.ohlcvData.clear();
        this.balances.clear();
        this.orders.clear();
        this.ordersByClientId.clear();
        this.trades = [];
        this.faults.clear();
        this.nextOrderId = 1;
        this.nextTradeId = 1;
    }

    // ============================================================================
    // Utils
    // ============================================================================

    private parseSymbol(symbol: string): [string, string] {
        const parts = symbol.split('/');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
            throw new Error(`Invalid symbol format: ${symbol}`);
        }
        return [parts[0], parts[1]];
    }

    // ============================================================================
    // Inspection (for testing)
    // ============================================================================

    getOrderCount(): number {
        return this.orders.size;
    }

    getTradeCount(): number {
        return this.trades.length;
    }

    getAllOrders(): SimulatorOrder[] {
        return Array.from(this.orders.values());
    }

    getAllTrades(): SimulatorTrade[] {
        return [...this.trades];
    }
}
