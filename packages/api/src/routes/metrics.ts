/**
 * Prometheus Metrics 路由
 * 
 * GET /metrics - 返回 Prometheus 格式的指标
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { getMetrics, getContentType } from '@crypto-strategy-hub/observability';
import { createApiError } from '../middleware/error-handler.js';

export const metricsRouter = Router();

metricsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
        const metrics = await getMetrics();
        res.set('Content-Type', getContentType());
        res.send(metrics);
    } catch (error) {
        next(createApiError('Failed to collect metrics', 500, 'METRICS_COLLECT_FAILED'));
    }
});
