/**
 * @crypto-strategy-hub/exchange
 * 
 * 真实交易所 Executor 实现
 * 封装 ccxt，对外暴露 TradingExecutor 接口
 */

export * from './binance-executor.js';
export * from './ccxt-executor.js';
export * from './okx-executor.js';
export * from './huobi-executor.js';
export * from './bybit-executor.js';
export * from './coinbase-executor.js';
export * from './kraken-executor.js';
// Re-export shared types for convenience
export type { TradingExecutor, OpenOrder, FullOrderRecord, TradeRecord, CreateOrderParams, CreateOrderResult } from '@crypto-strategy-hub/shared';
