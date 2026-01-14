/**
 * Prometheus 指标定义
 * 
 * 来源：implementation_plan.md §2.6.1
 * 
 * 指标命名规范：
 * - 前缀：csh_ (crypto-strategy-hub)
 * - 计数器：xxx_total
 * - 直方图：xxx_seconds / xxx_bytes
 * - 仪表盘：xxx (无后缀)
 */

import {
    Registry,
    Counter,
    Histogram,
    Gauge,
    collectDefaultMetrics,
} from 'prom-client';

// ============================================================================
// Registry
// ============================================================================

export const registry = new Registry();

// 收集默认指标（CPU、内存、事件循环等）
collectDefaultMetrics({ register: registry, prefix: 'csh_' });

// ============================================================================
// Exchange 请求指标
// ============================================================================

/**
 * 交易所 API 请求总数
 * Labels: exchange, endpoint, result (success/error/timeout/ratelimit)
 */
export const exchangeRequestsTotal = new Counter({
    name: 'csh_exchange_requests_total',
    help: 'Total number of exchange API requests',
    labelNames: ['exchange', 'endpoint', 'result'] as const,
    registers: [registry],
});

/**
 * 交易所 API 请求耗时
 * Labels: exchange, endpoint
 */
export const exchangeRequestDuration = new Histogram({
    name: 'csh_exchange_request_duration_seconds',
    help: 'Duration of exchange API requests in seconds',
    labelNames: ['exchange', 'endpoint'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
});

// ============================================================================
// Order 指标
// ============================================================================

/**
 * 下单总数
 * Labels: exchange, symbol, side, type
 */
export const ordersPlacedTotal = new Counter({
    name: 'csh_orders_placed_total',
    help: 'Total number of orders placed',
    labelNames: ['exchange', 'symbol', 'side', 'type'] as const,
    registers: [registry],
});

/**
 * 撤单总数
 * Labels: exchange, symbol
 */
export const ordersCanceledTotal = new Counter({
    name: 'csh_orders_canceled_total',
    help: 'Total number of orders canceled',
    labelNames: ['exchange', 'symbol'] as const,
    registers: [registry],
});

/**
 * 重复 clientOrderId 检测次数（幂等命中）
 * Labels: exchange
 */
export const ordersDuplicateTotal = new Counter({
    name: 'csh_orders_duplicate_total',
    help: 'Total number of duplicate clientOrderId detections',
    labelNames: ['exchange'] as const,
    registers: [registry],
});

/**
 * 订单成交量（累计）
 * Labels: exchange, symbol, side
 */
export const orderFilledAmountTotal = new Counter({
    name: 'csh_order_filled_amount_total',
    help: 'Total filled amount of orders',
    labelNames: ['exchange', 'symbol', 'side'] as const,
    registers: [registry],
});

// ============================================================================
// Reconcile 指标
// ============================================================================

/**
 * Reconcile 耗时
 * Labels: exchange, symbol
 */
export const reconcileDuration = new Histogram({
    name: 'csh_reconcile_duration_seconds',
    help: 'Duration of reconcile operations in seconds',
    labelNames: ['exchange', 'symbol'] as const,
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [registry],
});

/**
 * Reconcile 失败总数
 * Labels: exchange, symbol
 */
export const reconcileFailTotal = new Counter({
    name: 'csh_reconcile_fail_total',
    help: 'Total number of reconcile failures',
    labelNames: ['exchange', 'symbol'] as const,
    registers: [registry],
});

// ============================================================================
// Bot 状态指标
// ============================================================================

/**
 * Bot 状态分布
 * Labels: strategy_type, status
 */
export const botStatus = new Gauge({
    name: 'csh_bot_status',
    help: 'Current bot status distribution (1 = active)',
    labelNames: ['strategy_type', 'status'] as const,
    registers: [registry],
});

/**
 * 活跃 Bot 数量
 */
export const activeBotsTotal = new Gauge({
    name: 'csh_active_bots_total',
    help: 'Number of currently active bots',
    registers: [registry],
});

// ============================================================================
// 条件系统指标
// ============================================================================

/**
 * 条件阻断次数
 * Labels: type (trigger/gate/adaptive), reason
 */
export const conditionBlockTotal = new Counter({
    name: 'csh_condition_block_total',
    help: 'Total number of condition blocks',
    labelNames: ['type', 'reason'] as const,
    registers: [registry],
});

// ============================================================================
// 自适应/波动率指标
// ============================================================================

/**
 * 混合波动率
 * Labels: symbol
 */
export const volatilityHybrid = new Gauge({
    name: 'csh_volatility_hybrid',
    help: 'Current hybrid volatility value',
    labelNames: ['symbol'] as const,
    registers: [registry],
});

/**
 * 当前网格大小
 * Labels: symbol
 */
export const gridSizeCurrent = new Gauge({
    name: 'csh_grid_size_current',
    help: 'Current grid size percentage',
    labelNames: ['symbol'] as const,
    registers: [registry],
});

// ============================================================================
// 风控告警指标
// ============================================================================

/**
 * 风控触发次数
 * Labels: type (stop_loss/take_profit/auto_close/kill_switch)
 */
export const riskTriggeredTotal = new Counter({
    name: 'csh_risk_triggered_total',
    help: 'Total number of risk events triggered',
    labelNames: ['type'] as const,
    registers: [registry],
});

/**
 * 告警发送次数
 * Labels: channel (telegram/webhook/pushplus), status (success/fail)
 */
export const alertsSentTotal = new Counter({
    name: 'csh_alerts_sent_total',
    help: 'Total number of alerts sent',
    labelNames: ['channel', 'status'] as const,
    registers: [registry],
});

// ============================================================================
// Worker 指标
// ============================================================================

/**
 * Worker tick 耗时
 */
export const workerTickDuration = new Histogram({
    name: 'csh_worker_tick_duration_seconds',
    help: 'Duration of worker tick in seconds',
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [registry],
});

/**
 * Worker 处理的 Bot 数量（每 tick）
 */
export const workerBotsProcessed = new Gauge({
    name: 'csh_worker_bots_processed',
    help: 'Number of bots processed in last tick',
    registers: [registry],
});

/**
 * Worker 错误数量（每 tick）
 */
export const workerErrors = new Counter({
    name: 'csh_worker_errors_total',
    help: 'Total number of worker errors',
    registers: [registry],
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 获取所有指标的 Prometheus 格式输出
 */
export async function getMetrics(): Promise<string> {
    return registry.metrics();
}

/**
 * 获取 Content-Type
 */
export function getContentType(): string {
    return registry.contentType;
}

/**
 * 重置所有指标（用于测试）
 */
export function resetMetrics(): void {
    registry.resetMetrics();
}
