/**
 * Generic CCXT TradingExecutor
 *
 * - Uses ccxt unified API (spot)
 * - Maps ccxt order status to shared OrderStatus
 * - Filters our orders by ORDER_PREFIX
 */

import ccxt, { type Exchange, type Order, type Trade } from 'ccxt';
import type {
    TradingExecutor,
    OpenOrder,
    FullOrderRecord,
    TradeRecord,
    CreateOrderParams,
    CreateOrderResult,
    Balance,
} from '@crypto-strategy-hub/shared';
import { DuplicateOrderError, ORDER_PREFIX, OrderStatus } from '@crypto-strategy-hub/shared';
import {
    getCcxtProxyConfig,
    isLikelyDuplicateClientOrderIdError,
    mapCcxtError,
    trySetSandboxMode,
} from '@crypto-strategy-hub/ccxt-utils';

export interface CcxtExecutorConfig {
    exchangeId: string; // ccxt exchange id, e.g. 'okx' | 'huobi' | 'htx'
    apiKey: string;
    secret: string;
    passphrase?: string;
    isTestnet?: boolean;
    allowMainnet?: boolean;
}

function extractClientOrderIdFromOrder(order: Order): string | undefined {
    const direct = (order as any).clientOrderId as string | undefined;
    if (direct) return direct;

    const info = (order as any).info as any;
    return (
        info?.clientOrderId ||
        info?.clOrdId ||
        info?.['client-order-id'] ||
        info?.client_order_id ||
        undefined
    );
}

function extractClientOrderIdFromTrade(trade: Trade): string | undefined {
    const info = (trade as any).info as any;
    return (
        info?.clientOrderId ||
        info?.clOrdId ||
        info?.['client-order-id'] ||
        info?.client_order_id ||
        undefined
    );
}

function mapCcxtOrderStatus(order: Order): OrderStatus {
    const raw = (order.status ?? '').toString().toLowerCase();
    if (raw === 'open') {
        const filled = typeof order.filled === 'number' ? order.filled : 0;
        return filled > 0 ? OrderStatus.PARTIALLY_FILLED : OrderStatus.NEW;
    }
    if (raw === 'closed') return OrderStatus.FILLED;
    if (raw === 'canceled' || raw === 'cancelled') return OrderStatus.CANCELED;
    if (raw === 'expired') return OrderStatus.EXPIRED;
    if (raw === 'rejected') return OrderStatus.REJECTED;
    return OrderStatus.NEW;
}

function createExchange(config: CcxtExecutorConfig): Exchange {
    const Ctor = (ccxt as any)[config.exchangeId] as (new (...args: any[]) => Exchange) | undefined;
    if (!Ctor) {
        throw new Error(`Unsupported CCXT exchange: ${config.exchangeId}`);
    }

    if (!config.isTestnet && !config.allowMainnet) {
        throw new Error('Mainnet trading not allowed unless allowMainnet=true');
    }

    const proxyConfig = getCcxtProxyConfig();
    const exchange = new Ctor({
        apiKey: config.apiKey,
        secret: config.secret,
        password: config.passphrase,
        enableRateLimit: true,
        ...proxyConfig,
        options: {
            defaultType: 'spot',
            adjustForTimeDifference: true,
            fetchMarkets: { types: ['spot'] },
        },
    });

    if (config.isTestnet) {
        const sandboxEnabled = trySetSandboxMode(exchange, true);
        if (!sandboxEnabled) {
            throw new Error('TESTNET_NOT_SUPPORTED');
        }
    }

    return exchange;
}

export class CcxtExecutor implements TradingExecutor {
    private exchange: Exchange;
    private exchangeId: string;

    constructor(config: CcxtExecutorConfig) {
        this.exchangeId = config.exchangeId;
        this.exchange = createExchange(config);
    }

    async fetchOpenOrders(symbol: string): Promise<OpenOrder[]> {
        try {
            const orders = await this.exchange.fetchOpenOrders(symbol);
            return orders
                .map((o) => ({ order: o, clientOrderId: extractClientOrderIdFromOrder(o) }))
                .filter((x) => (x.clientOrderId?.startsWith(ORDER_PREFIX) ?? false))
                .map((x) => ({
                    id: x.order.id,
                    symbol: x.order.symbol,
                    clientOrderId: x.clientOrderId!,
                }));
        } catch (error) {
            throw mapCcxtError('fetchOpenOrders', error, symbol);
        }
    }

    async fetchOpenOrdersFull(symbol: string): Promise<FullOrderRecord[]> {
        try {
            const orders = await this.exchange.fetchOpenOrders(symbol);
            return orders
                .map((o) => ({ order: o, clientOrderId: extractClientOrderIdFromOrder(o) }))
                .filter((x) => (x.clientOrderId?.startsWith(ORDER_PREFIX) ?? false))
                .map((x) => this.mapToFullOrder(x.order, x.clientOrderId!));
        } catch (error) {
            throw mapCcxtError('fetchOpenOrdersFull', error, symbol);
        }
    }

    async fetchMyTrades(symbol: string, since?: string): Promise<TradeRecord[]> {
        let trades: Trade[];
        try {
            const sinceTs = since ? new Date(since).getTime() : undefined;
            trades = await this.exchange.fetchMyTrades(symbol, sinceTs);
        } catch (error) {
            throw mapCcxtError('fetchMyTrades', error, symbol);
        }

        return trades.map((t) => ({
            id: t.id || '',
            orderId: t.order || '',
            clientOrderId: extractClientOrderIdFromTrade(t),
            symbol: t.symbol || symbol,
            side: t.side as 'buy' | 'sell',
            price: String(t.price),
            amount: String(t.amount),
            fee: t.fee ? String(t.fee.cost) : '0',
            feeCurrency: t.fee ? (t.fee.currency || '') : '',
            timestamp: t.timestamp ? new Date(t.timestamp).toISOString() : new Date().toISOString(),
        }));
    }

    async cancelOrder(orderId: string, symbol: string): Promise<void> {
        try {
            await this.exchange.cancelOrder(orderId, symbol);
        } catch (error: any) {
            const msg = error?.message ? String(error.message) : '';
            if (error instanceof ccxt.OrderNotFound || /order.*not.*found|unknown order/i.test(msg)) {
                return;
            }
            throw mapCcxtError('cancelOrder', error, symbol);
        }
    }

    async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
        const side = params.side;
        const type = params.type;
        const price = type === 'limit' ? parseFloat(params.price ?? '0') : undefined;

        try {
            const order = await this.exchange.createOrder(
                params.symbol,
                type,
                side,
                parseFloat(params.amount),
                price,
                { clientOrderId: params.clientOrderId }
            );

            return {
                exchangeOrderId: order.id,
                clientOrderId: params.clientOrderId,
                status: mapCcxtOrderStatus(order),
            };
        } catch (error) {
            if (isLikelyDuplicateClientOrderIdError(error)) {
                console.warn(
                    `[CcxtExecutor:${this.exchangeId}] Duplicate order ${params.clientOrderId}, searching open orders...`
                );

                // Try to recover the existing open order to keep idempotency.
                let openOrders: Order[];
                try {
                    openOrders = await this.exchange.fetchOpenOrders(params.symbol);
                } catch (fetchErr) {
                    throw mapCcxtError('fetchOpenOrders', fetchErr, params.symbol);
                }

                const existing = openOrders.find(
                    (o) => extractClientOrderIdFromOrder(o) === params.clientOrderId
                );
                if (existing?.id) {
                    return {
                        exchangeOrderId: existing.id,
                        clientOrderId: params.clientOrderId,
                        status: mapCcxtOrderStatus(existing),
                    };
                }

                throw new DuplicateOrderError(params.clientOrderId, error);
            }

            throw mapCcxtError('createOrder', error, params.symbol);
        }
    }

    private mapToFullOrder(order: Order, clientOrderId: string): FullOrderRecord {
        return {
            id: order.id,
            symbol: order.symbol,
            clientOrderId,
            side: order.side as 'buy' | 'sell',
            type: order.type as 'limit' | 'market',
            price: String(order.price ?? 0),
            amount: String(order.amount ?? 0),
            filledAmount: String(order.filled ?? 0),
            status: mapCcxtOrderStatus(order),
        };
    }

    async fetchBalance(): Promise<Record<string, Balance>> {
        try {
            const balance = await this.exchange.fetchBalance();
            const result: Record<string, Balance> = {};

            Object.keys(balance.total).forEach((asset) => {
                const total = (balance.total as any)[asset];
                if (total !== undefined && total > 0) {
                    result[asset] = {
                        free: (balance.free as any)[asset]?.toString() || '0',
                        locked: (balance.used as any)[asset]?.toString() || '0',
                        total: total.toString(),
                    };
                }
            });
            return result;
        } catch (error) {
            throw mapCcxtError('fetchBalance', error);
        }
    }
}

export function createCcxtExecutor(config: CcxtExecutorConfig): TradingExecutor {
    return new CcxtExecutor(config);
}
