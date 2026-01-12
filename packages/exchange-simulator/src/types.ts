/**
 * ExchangeSimulator Types
 */

import type { DecimalString, OrderSide, OrderType } from '@crypto-strategy-hub/shared';

/** 错误注入端点 */
export type FaultEndpoint =
    | 'createOrder'
    | 'cancelOrder'
    | 'fetchOpenOrders'
    | 'fetchBalance'
    | 'fetchMyTrades'
    | 'fetchOHLCV';

/** 错误注入模式 */
export type FaultMode = 'timeout' | 'rateLimit' | 'auth' | 'badRequest';

/** 错误注入配置 */
export interface FaultInjection {
    endpoint: FaultEndpoint;
    mode: FaultMode;
    remainingCount: number;
    retryAfterMs?: number;  // 用于 rateLimit
}

/** OHLCV 蜡烛数据 */
export interface OHLCV {
    timestamp: number;
    open: DecimalString;
    high: DecimalString;
    low: DecimalString;
    close: DecimalString;
    volume: DecimalString;
}

/** Order Book Entry */
export interface OrderBookEntry {
    price: DecimalString;
    amount: DecimalString;
}

/** Order Book */
export interface OrderBook {
    bids: OrderBookEntry[];
    asks: OrderBookEntry[];
    timestamp: number;
}

/** Ticker */
export interface Ticker {
    symbol: string;
    last: DecimalString;
    bid?: DecimalString;
    ask?: DecimalString;
    timestamp: number;
}

/** Balance */
export interface SimulatorBalance {
    free: DecimalString;
    locked: DecimalString;
}

/** 模拟器内部订单 */
export interface SimulatorOrder {
    exchangeOrderId: string;
    clientOrderId: string;
    symbol: string;
    side: OrderSide;
    type: OrderType;
    status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED';
    price?: DecimalString;
    amount: DecimalString;
    filledAmount: DecimalString;
    avgFillPrice?: DecimalString;
    createdAt: string;
    updatedAt: string;
}

/** 模拟器成交记录 */
export interface SimulatorTrade {
    tradeId: string;
    orderId: string;
    clientOrderId: string;
    symbol: string;
    side: OrderSide;
    price: DecimalString;
    amount: DecimalString;
    fee: DecimalString;
    feeCurrency: string;
    timestamp: string;
}
