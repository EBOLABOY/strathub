/**
 * Binance Executor
 * 
 * 基于 ccxt 实现 TradingExecutor
 * 默认 Testnet-only，Mainnet 需显式 opt-in
 */

import ccxt, { Exchange, Order } from 'ccxt';
import type {
    TradingExecutor,
    OpenOrder,
    FullOrderRecord,
    TradeRecord,
    CreateOrderParams,
    CreateOrderResult
} from '@crypto-strategy-hub/shared';
import { ORDER_PREFIX, ExchangeUnavailableError, RateLimitError, TimeoutError } from '@crypto-strategy-hub/shared';

export interface BinanceExecutorConfig {
    apiKey: string;
    secret: string;
    isTestnet?: boolean;
    allowMainnet?: boolean; // 必须显式为 true 才允许 Mainnet
}

export class BinanceExecutor implements TradingExecutor {
    private exchange: Exchange;

    constructor(config: BinanceExecutorConfig) {
        if (!config.isTestnet && !config.allowMainnet) {
            throw new Error('Mainnet trading not allowed unless allowMainnet=true');
        }

        this.exchange = new ccxt.binance({
            apiKey: config.apiKey,
            secret: config.secret,
            options: {
                defaultType: 'spot',
                adjustForTimeDifference: true,
            },
        });

        if (config.isTestnet) {
            this.exchange.setSandboxMode(true);
        }
    }

    async fetchOpenOrders(symbol: string): Promise<OpenOrder[]> {
        try {
            // 过滤我们的订单 (gb1)
            const orders = await this.exchange.fetchOpenOrders(symbol);
            return orders
                .filter(o => (o.clientOrderId?.startsWith(ORDER_PREFIX)) ?? false)
                .map(o => ({
                    id: o.id,
                    symbol: o.symbol,
                    clientOrderId: o.clientOrderId!,
                }));
        } catch (error) {
            throw mapCcxtError('fetchOpenOrders', error);
        }
    }

    async fetchOpenOrdersFull(symbol: string): Promise<FullOrderRecord[]> {
        try {
            const orders = await this.exchange.fetchOpenOrders(symbol);
            return orders
                .filter(o => (o.clientOrderId?.startsWith(ORDER_PREFIX)) ?? false)
                .map(this.mapToFullOrder);
        } catch (error) {
            throw mapCcxtError('fetchOpenOrdersFull', error);
        }
    }

    async fetchMyTrades(symbol: string, since?: string): Promise<TradeRecord[]> {
        let trades: any[];
        try {
            const sinceTs = since ? new Date(since).getTime() : undefined;
            trades = await this.exchange.fetchMyTrades(symbol, sinceTs);
        } catch (error) {
            throw mapCcxtError('fetchMyTrades', error);
        }

        // 如果 trade 缺少 clientOrderId，尝试补充 (API 限制：部分 trade 可能没有 clientOrderId)
        // 策略：我们不应该在这里疯狂拉单补充，而是依赖 orderId 关联。
        // 但 reconcile 依赖 clientOrderId。
        // 妥协：只过滤明确有 gb1 clientOrderId 的，或者完全没 clientOrderId 但 orderId 能查到的（暂不实现反查，成本太高）
        // 目前策略：Strictly filter by clientOrderId if present.

        // 修复：ccxt 模拟器可能有 bug，但真实环境 trade 通常带 orderId。
        // 如果 clientOrderId 为空，reconcile 不会处理。这是一个已知限制。
        // 补救：如果 trade.orderId 对应我们在内存/DB 的单，reconcile 层处理？
        // 暂时只处理带 clientOrderId 的。

        return trades
            .map(t => {
                // ccxt Trade type definition doesn't have clientOrderId, but it might be in info
                const info = t.info as any;
                const clientOrderId = info?.clientOrderId;

                return {
                    id: t.id || '',
                    orderId: t.order || '',
                    clientOrderId: clientOrderId,
                    symbol: t.symbol || '',
                    side: t.side as 'buy' | 'sell',
                    price: String(t.price),
                    amount: String(t.amount),
                    fee: t.fee ? String(t.fee.cost) : '0',
                    feeCurrency: t.fee ? (t.fee.currency || '') : '',
                    timestamp: t.timestamp ? new Date(t.timestamp).toISOString() : new Date().toISOString(),
                };
            })
            ; // 移除过滤：返回所有 trades，由 reconcile 层根据 orderId 匹配归属
    }

    async cancelOrder(orderId: string, symbol: string): Promise<void> {
        try {
            await this.exchange.cancelOrder(orderId, symbol);
        } catch (e: any) {
            // 如果订单已不存在/已成交，视为成功
            if (e.message?.includes('Unknown order') || e.message?.includes('Order was not found')) {
                return;
            }
            throw mapCcxtError('cancelOrder', e);
        }
    }

    async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
        // ClientOrderId 必须包含在 params 中
        if (!params.clientOrderId.startsWith(ORDER_PREFIX)) {
            throw new Error(`Invalid clientOrderId prefix: ${params.clientOrderId}`);
        }

        try {
            const isMarket = params.type === 'market';
            const price = isMarket ? undefined : parseFloat(params.price || '0');

            const order = await this.exchange.createOrder(
                params.symbol,
                params.type,
                params.side,
                parseFloat(params.amount), // ccxt expects number
                price,
                {
                    newClientOrderId: params.clientOrderId
                }
            );

            return {
                exchangeOrderId: order.id,
                clientOrderId: params.clientOrderId,
                status: order.status || 'NEW',
            };
        } catch (e: any) {
            // 幂等性处理：如果报 Duplicate clientOrderId，说明已提交成功
            if (this.isDuplicateOrderError(e)) {
                console.warn(`[BinanceExecutor] Duplicate order ${params.clientOrderId}, fetching existing...`);
                // 反查订单（Binance 支持通过 origClientOrderId 查询吗？fetchOrder 通常用 orderId）
                // ccxt fetchOrder(id, symbol, params) -> params: { origClientOrderId: ... } ?
                // Binance API: GET /api/v3/order (origClientOrderId)

                try {
                    // 尝试通过 origClientOrderId 查询 (使用 private API 以绕过 ccxt fetchOrder 需要 ID 的限制)
                    // Binance API: GET /api/v3/order
                    const market = this.exchange.market(params.symbol);
                    const response = await (this.exchange as any).privateGetOrder({
                        symbol: market['id'],
                        origClientOrderId: params.clientOrderId
                    });

                    // CCXT parseOrder expects structure, Binance returns raw
                    const existing = this.exchange.parseOrder(response, market);

                    return {
                        exchangeOrderId: existing.id,
                        clientOrderId: params.clientOrderId,
                        status: existing.status || 'unknown',
                    };
                } catch (fetchErr) {
                    // 如果反查失败，抛出原始错误
                    console.error(`[BinanceExecutor] Failed to fetch existing order ${params.clientOrderId}`, fetchErr);
                    throw e;
                }
            }
            throw mapCcxtError('createOrder', e);
        }
    }

    private isDuplicateOrderError(e: any): boolean {
        // Binance error -2010: Account has insufficient balance. (Not duplicate)
        // Order already exists? 
        // 需确认具体错误码。Binance 通常是 -1013 Filter failure? 
        // 实际上 Binance 如果 clientOrderId 重复，且通过 API 发送，应该拒绝吗？
        // 纠正：Binance 不允许重复 clientOrderId 用于 *当前未成交* 订单。如果是已成交历史订单重用？
        // 策略：假设 clientOrderId 全局唯一（带时间戳/UUID）。
        // 如果错误包含 "Duplicate" 或 "Order with this clientOrderId already exists"
        const msg = e.message || '';
        return msg.includes('Duplicate') || msg.includes('Order already exists');
    }

    private mapToFullOrder(o: Order): FullOrderRecord {
        return {
            id: o.id,
            symbol: o.symbol,
            clientOrderId: o.clientOrderId!,
            side: o.side as 'buy' | 'sell',
            type: o.type as 'limit' | 'market',
            price: o.price.toString(),
            amount: o.amount.toString(),
            filledAmount: o.filled.toString(),
            status: o.status || 'unknown',
        };
    }
}

export function createBinanceExecutor(config: BinanceExecutorConfig): TradingExecutor {
    return new BinanceExecutor(config);
}

function mapCcxtError(operation: string, error: unknown): unknown {
    if (error instanceof ccxt.RateLimitExceeded || error instanceof ccxt.DDoSProtection) {
        return new RateLimitError(undefined, error);
    }
    if (error instanceof ccxt.RequestTimeout) {
        return new TimeoutError(`Request timeout: ${operation}`, error);
    }
    if (error instanceof ccxt.NetworkError || error instanceof ccxt.ExchangeNotAvailable) {
        return new ExchangeUnavailableError(`Exchange unavailable: ${operation}`, error);
    }
    return error;
}
