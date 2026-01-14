/**
 * Prometheus Metrics 路由
 * 
 * GET /metrics - 返回 Prometheus 格式的指标
 */

import { Router } from 'express';
import { getMetrics, getContentType } from '@crypto-strategy-hub/observability';

export const metricsRouter = Router();

metricsRouter.get('/', async (_req, res) => {
    try {
        const metrics = await getMetrics();
        res.set('Content-Type', getContentType());
        res.send(metrics);
    } catch (error) {
        console.error('[Metrics] Error collecting metrics:', error);
        res.status(500).json({ error: 'Failed to collect metrics' });
    }
});
