/**
 * Simulator Executor Adapter
 * 
 * 包装 ExchangeSimulator 实现 TradingExecutor 接口
 * 用于 STOPPING/reconcile/trigger loop
 */

import { ExchangeSimulator } from '@crypto-strategy-hub/exchange-simulator';
import type {
    TradingExecutor,
    TestableExecutor,
    OpenOrder,
    FullOrderRecord,
    TradeRecord,
    CreateOrderParams,
    CreateOrderResult,
    Balance,
} from '@crypto-strategy-hub/shared';
import { ORDER_PREFIX } from '@crypto-strategy-hub/shared';

// Re-export for backward compatibility
export { ORDER_PREFIX };
export type { TradingExecutor, TestableExecutor, OpenOrder, FullOrderRecord, TradeRecord, CreateOrderParams, CreateOrderResult };

// Legacy type aliases for backward compatibility
export type ReconcileExecutor = TradingExecutor;
export type TriggerExecutor = TestableExecutor;

// ============================================================================
// SimulatorExecutor
// ============================================================================

// Helper to map simulator status to standard status
function mapStatus(s: string): string {
    const upper = s.toUpperCase();
    if (upper === 'OPEN') return 'NEW';
    if (upper === 'CLOSED') return 'FILLED';
    if (upper === 'CANCELED' || upper === 'CANCELLED') return 'CANCELED';
    return upper;
}

export function createSimulatorExecutor(
    simulator: ExchangeSimulator
): TestableExecutor {
    let createOrderCallCount = 0;

    return {
        async fetchOpenOrders(symbol: string): Promise<OpenOrder[]> {
            const orders = await simulator.fetchOpenOrders(symbol);
            return orders
                .filter((o) => o.clientOrderId.startsWith(ORDER_PREFIX))
                .map((o) => ({
                    id: o.exchangeOrderId,
                    symbol: o.symbol,
                    clientOrderId: o.clientOrderId,
                }));
        },

        async fetchOpenOrdersFull(symbol: string): Promise<FullOrderRecord[]> {
            const orders = await simulator.fetchOpenOrders(symbol);
            return orders
                .filter((o) => o.clientOrderId.startsWith(ORDER_PREFIX))
                .map((o) => ({
                    id: o.exchangeOrderId,
                    symbol: o.symbol,
                    clientOrderId: o.clientOrderId,
                    side: o.side as 'buy' | 'sell',
                    type: o.type as 'limit' | 'market',
                    price: o.price ?? '0',
                    amount: o.amount,
                    filledAmount: o.filledAmount,
                    status: mapStatus(o.status),
                }));
        },

        async cancelOrder(orderId: string, symbol: string): Promise<void> {
            await simulator.cancelOrder(orderId, symbol);
        },

        async fetchMyTrades(symbol: string, since?: string): Promise<TradeRecord[]> {
            const trades = await simulator.fetchMyTrades(symbol, since);
            return trades
                .filter((t) => t.clientOrderId?.startsWith(ORDER_PREFIX))
                .map((t) => ({
                    id: t.tradeId,
                    orderId: t.orderId ?? '',
                    clientOrderId: t.clientOrderId,
                    symbol: t.symbol,
                    side: t.side as 'buy' | 'sell',
                    price: t.price,
                    amount: t.amount,
                    fee: t.fee,
                    feeCurrency: t.feeCurrency,
                    timestamp: t.timestamp,
                }));
        },

        async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
            createOrderCallCount++;
            const result = await simulator.createOrder({
                symbol: params.symbol,
                side: params.side,
                type: params.type,
                price: params.price,
                amount: params.amount,
                clientOrderId: params.clientOrderId,
            });
            return {
                exchangeOrderId: result.exchangeOrderId,
                clientOrderId: result.clientOrderId,
                status: mapStatus(result.status),
            };
        },

        async fetchBalance(): Promise<Record<string, Balance>> {
            const raw = await simulator.fetchBalance();
            const result: Record<string, Balance> = {};

            for (const [asset, bal] of raw.entries()) {
                const free = parseFloat(bal.free);
                const locked = parseFloat(bal.locked);
                const total = free + locked;

                if (total > 0) {
                    result[asset] = {
                        free: bal.free,
                        locked: bal.locked,
                        total: total.toFixed(8)
                    };
                }
            }
            return result;
        },

        getCreateOrderCallCount(): number {
            return createOrderCallCount;
        },
    };
}
