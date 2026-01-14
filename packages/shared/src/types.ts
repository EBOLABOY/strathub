/**
 * Shared Types for Crypto Strategy Hub
 * 
 * 冻结版本：V1
 * 来源：implementation_plan.md §2.8
 */

// ============================================================================
// Decimal String (避免 JS float 漂移)
// ============================================================================

/** 十进制字符串类型，用于价格/数量/金额 */
export type DecimalString = string;

// ============================================================================
// Order Types
// ============================================================================

/** 订单状态枚举 */
export enum OrderStatus {
    NEW = 'NEW',
    PARTIALLY_FILLED = 'PARTIALLY_FILLED',
    FILLED = 'FILLED',
    CANCELED = 'CANCELED',
    REJECTED = 'REJECTED',
    EXPIRED = 'EXPIRED',
}

/** 订单方向 */
export type OrderSide = 'buy' | 'sell';

/** 订单类型 */
export type OrderType = 'limit' | 'market';

/** 有效期类型 */
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';

/** 创建订单请求 */
export interface CreateOrderRequest {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    price?: DecimalString;
    amount: DecimalString;
    clientOrderId: string;
    timeInForce?: TimeInForce;
}

/** 交易所订单 */
export interface ExchangeOrder {
    exchange: string;
    symbol: string;
    clientOrderId: string;
    exchangeOrderId: string;
    status: OrderStatus;
    side: OrderSide;
    type: OrderType;
    price?: DecimalString;
    amount: DecimalString;
    filledAmount: DecimalString;
    avgFillPrice?: DecimalString;
    createdAt: string;
    updatedAt: string;
}

/** 成交记录 */
export interface ExchangeTrade {
    tradeId: string;
    orderId?: string;
    clientOrderId?: string;
    symbol: string;
    side: OrderSide;
    price: DecimalString;
    amount: DecimalString;
    fee: DecimalString;
    feeCurrency: string;
    timestamp: string;
}

// ============================================================================
// Bot Types
// ============================================================================

/** Bot 状态枚举 */
export enum BotStatus {
    DRAFT = 'DRAFT',
    WAITING_TRIGGER = 'WAITING_TRIGGER',
    RUNNING = 'RUNNING',
    PAUSED = 'PAUSED',
    STOPPING = 'STOPPING',
    STOPPED = 'STOPPED',
    ERROR = 'ERROR',
}

/** Bot 实体接口 (DTO) */
export interface Bot {
    id: string;
    userId: string;
    exchangeAccountId: string;
    symbol: string;
    configJson: string;
    configRevision: number;
    status: BotStatus | string;
    statusVersion: number;
    runId: string | null;
    lastError: string | null;
    createdAt: string | Date;
    updatedAt: string | Date;
}

/** Bot 事件枚举 */
export enum BotEvent {
    START = 'START',
    TRIGGER_HIT = 'TRIGGER_HIT',
    PAUSE = 'PAUSE',
    RESUME = 'RESUME',
    STOP = 'STOP',
    RISK_TRIGGERED = 'RISK_TRIGGERED',
    KILL_SWITCH = 'KILL_SWITCH',
    FATAL_ERROR = 'FATAL_ERROR',
    STOPPED_COMPLETE = 'STOPPED_COMPLETE',
}

/** Runtime Phase (UI 展示用) */
export type RuntimePhase = 'RECONCILING' | 'IDLE' | 'ACTIVE';

// ============================================================================
// Error Types
// ============================================================================

/** 错误分类 */
export enum ErrorClass {
    TRANSIENT = 'TRANSIENT',       // 超时/网络抖动/5xx
    RATE_LIMIT = 'RATE_LIMIT',     // 429/RateLimit
    AUTH = 'AUTH',                 // 签名错误/权限不足
    BAD_REQUEST = 'BAD_REQUEST',   // 参数错误/精度错误
    INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS', // 余额不足
    UNKNOWN = 'UNKNOWN',
}

/** 分类后的错误 */
export interface ClassifiedError {
    errorClass: ErrorClass;
    code?: string;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
}

// ============================================================================
// Market Types
// ============================================================================

/** 市场精度信息 */
export interface MarketPrecision {
    price: number;   // 价格小数位数
    amount: number;  // 数量小数位数
}

/** 市场限制 */
export interface MarketLimits {
    minAmount: DecimalString;
    maxAmount?: DecimalString;
    minNotional: DecimalString;  // 最小名义价值
}

/** 市场信息 */
export interface MarketInfo {
    symbol: string;
    base: string;     // 基础资产 e.g. BNB
    quote: string;    // 报价资产 e.g. USDT
    precision: MarketPrecision;
    limits: MarketLimits;
}

// ============================================================================
// Balance Types
// ============================================================================

/** 账户余额 */
export interface Balance {
    asset?: string;
    free: DecimalString;
    locked: DecimalString;
    total: DecimalString;
}
