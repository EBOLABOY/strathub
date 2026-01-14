/**
 * Observability 包测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    getMetrics,
    getContentType,
    resetMetrics,
    ordersPlacedTotal,
    exchangeRequestsTotal,
    riskTriggeredTotal,
    alertsSentTotal,
} from '../src/metrics.js';

describe('Prometheus Metrics', () => {
    beforeEach(() => {
        resetMetrics();
    });

    it('应该返回 Prometheus 格式的指标', async () => {
        const metrics = await getMetrics();

        expect(metrics).toContain('# HELP');
        expect(metrics).toContain('# TYPE');
        expect(metrics).toContain('csh_');
    });

    it('Content-Type 应该是 Prometheus 格式', () => {
        const contentType = getContentType();

        expect(contentType).toContain('text/plain');
    });

    it('ordersPlacedTotal 应该正确计数', async () => {
        ordersPlacedTotal.inc({ exchange: 'binance', symbol: 'BNB/USDT', side: 'buy', type: 'limit' });
        ordersPlacedTotal.inc({ exchange: 'binance', symbol: 'BNB/USDT', side: 'buy', type: 'limit' });
        ordersPlacedTotal.inc({ exchange: 'binance', symbol: 'BNB/USDT', side: 'sell', type: 'market' });

        const metrics = await getMetrics();

        expect(metrics).toContain('csh_orders_placed_total');
        expect(metrics).toContain('side="buy"');
        expect(metrics).toContain('side="sell"');
    });

    it('exchangeRequestsTotal 应该记录不同结果', async () => {
        exchangeRequestsTotal.inc({ exchange: 'binance', endpoint: 'createOrder', result: 'success' });
        exchangeRequestsTotal.inc({ exchange: 'binance', endpoint: 'createOrder', result: 'error' });
        exchangeRequestsTotal.inc({ exchange: 'binance', endpoint: 'fetchBalance', result: 'timeout' });

        const metrics = await getMetrics();

        expect(metrics).toContain('csh_exchange_requests_total');
        expect(metrics).toContain('result="success"');
        expect(metrics).toContain('result="error"');
    });

    it('riskTriggeredTotal 应该记录风控事件', async () => {
        riskTriggeredTotal.inc({ type: 'stop_loss' });
        riskTriggeredTotal.inc({ type: 'auto_close' });

        const metrics = await getMetrics();

        expect(metrics).toContain('csh_risk_triggered_total');
        expect(metrics).toContain('type="stop_loss"');
    });

    it('alertsSentTotal 应该记录告警发送', async () => {
        alertsSentTotal.inc({ channel: 'telegram', status: 'success' });
        alertsSentTotal.inc({ channel: 'webhook', status: 'fail' });

        const metrics = await getMetrics();

        expect(metrics).toContain('csh_alerts_sent_total');
        expect(metrics).toContain('channel="telegram"');
    });
});
