/**
 * Worker 指标记录
 * 
 * 提供便捷方法来记录 Worker 相关的 Prometheus 指标
 */

import {
    workerTickDuration,
    workerBotsProcessed,
    workerErrors,
    activeBotsTotal,
    riskTriggeredTotal,
    getAlertService,
} from '@crypto-strategy-hub/observability';

export interface TickMetrics {
    durationMs: number;
    processed: number;
    errors: number;
    activeBots: number;
}

/**
 * 记录 tick 指标
 */
export function recordTickMetrics(metrics: TickMetrics): void {
    workerTickDuration.observe(metrics.durationMs / 1000);
    workerBotsProcessed.set(metrics.processed);
    activeBotsTotal.set(metrics.activeBots);

    if (metrics.errors > 0) {
        workerErrors.inc(metrics.errors);
    }
}

/**
 * 记录风控触发
 */
export function recordRiskTriggered(type: 'stop_loss' | 'take_profit' | 'auto_close' | 'kill_switch'): void {
    riskTriggeredTotal.inc({ type });
}

/**
 * 发送告警（如果已配置告警服务）
 */
export async function sendAlert(
    level: 'critical' | 'warning' | 'info',
    title: string,
    message: string,
    extra?: { botId?: string; symbol?: string }
): Promise<void> {
    const alertService = getAlertService();
    if (alertService) {
        await alertService.send({
            level,
            title,
            message,
            ...extra,
        });
    }
}

/**
 * 发送严重告警
 */
export async function alertCritical(title: string, message: string, extra?: { botId?: string; symbol?: string }): Promise<void> {
    await sendAlert('critical', title, message, extra);
}

/**
 * 发送警告
 */
export async function alertWarning(title: string, message: string, extra?: { botId?: string; symbol?: string }): Promise<void> {
    await sendAlert('warning', title, message, extra);
}
