/**
 * @crypto-strategy-hub/exchange
 * 
 * 真实交易所 Executor 实现
 * 封装 ccxt，对外暴露 TradingExecutor 接口
 */

export * from './binance-executor.js';
// Re-export shared types for convenience
export type { TradingExecutor, OpenOrder, FullOrderRecord, TradeRecord, CreateOrderParams, CreateOrderResult } from '@crypto-strategy-hub/shared';
