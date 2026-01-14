/**
 * TradingExecutor 接口定义
 * 
 * 生产接口，simulator/binance 都是实现
 * 测试专用钩子请用 TestableExecutor
 */
import { Balance } from './types.js';

// ============================================================================
// 基础类型
// ============================================================================

export interface OpenOrder {
    id: string;
    symbol: string;
    clientOrderId: string;
}

export interface FullOrderRecord {
    id: string;
    symbol: string;
    clientOrderId: string;
    side: 'buy' | 'sell';
    type: 'limit' | 'market';
    price: string;
    amount: string;
    filledAmount: string;
    status: string;
}

export interface TradeRecord {
    id: string;
    orderId: string;
    clientOrderId?: string;
    symbol: string;
    side: 'buy' | 'sell';
    price: string;
    amount: string;
    fee: string;
    feeCurrency: string;
    timestamp: string;
}

export interface CreateOrderParams {
    symbol: string;
    side: 'buy' | 'sell';
    type: 'limit' | 'market';
    price?: string;
    amount: string;
    clientOrderId: string;
}

export interface CreateOrderResult {
    exchangeOrderId: string;
    clientOrderId: string;
    status: string;
}



// ============================================================================
// TradingExecutor（生产接口）
// ============================================================================

/**
 * 交易执行器接口
 * 
 * 实现：SimulatorExecutor, BinanceExecutor
 */
export interface TradingExecutor {
    /** 获取 open orders（简化版，用于 STOPPING） */
    fetchOpenOrders(symbol: string): Promise<OpenOrder[]>;

    /** 获取 open orders（完整版，用于 reconcile） */
    fetchOpenOrdersFull(symbol: string): Promise<FullOrderRecord[]>;

    /** 获取成交记录 */
    fetchMyTrades(symbol: string, since?: string): Promise<TradeRecord[]>;

    /** 取消订单 */
    cancelOrder(orderId: string, symbol: string): Promise<void>;

    /** 创建订单 */
    createOrder(params: CreateOrderParams): Promise<CreateOrderResult>;

    /** 获取账户余额 (Map<Asset, Balance>) */
    fetchBalance(): Promise<Record<string, Balance>>;
}

// ============================================================================
// TestableExecutor（测试专用扩展）
// ============================================================================

/**
 * 可测试的执行器接口
 * 
 * 继承 TradingExecutor + 测试钩子
 * 不应在生产代码中使用
 */
export interface TestableExecutor extends TradingExecutor {
    /** 用于测试断言 createOrder 实际调用次数 */
    getCreateOrderCallCount(): number;
}

// ============================================================================
// 常量
// ============================================================================

/** 我方订单前缀 */
export const ORDER_PREFIX = 'gb1';
