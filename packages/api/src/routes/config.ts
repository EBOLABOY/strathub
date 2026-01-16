/**
 * Config API Routes
 * 
 * 配置中心相关端点
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '@crypto-strategy-hub/database';
import { authGuard, requireUserId } from '../middleware/auth-guard.js';
import { createApiError } from '../middleware/error-handler.js';

export const configRouter = Router();

// 所有配置路由需要认证
configRouter.use(authGuard);

const importSchema = z.object({
    configs: z.array(
        z.object({
            key: z.string().min(1),
            value: z.string(),
            description: z.string().optional(),
        })
    ),
});

const batchUpdateSchema = z.object({
    items: z.array(
        z.object({
            key: z.string().min(1),
            value: z.string(),
        })
    ),
});

const updateSchema = z.object({
    value: z.string(),
    description: z.string().optional(),
});

const rollbackSchema = z.object({
    historyId: z.string().uuid(),
});

// GET /api/config - 获取所有配置项
configRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserId(req);
        const configs = await prisma.configItem.findMany({
            orderBy: [{ category: 'asc' }, { key: 'asc' }],
        });
        res.json(configs);
    } catch (error) {
        next(error);
    }
});

// GET /api/config/export - 导出所有配置
configRouter.get('/export', async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserId(req);
        const configs = await prisma.configItem.findMany({
            select: {
                key: true,
                value: true,
                description: true,
                category: true,
            },
            orderBy: [{ category: 'asc' }, { key: 'asc' }],
        });
        res.json({ configs });
    } catch (error) {
        next(error);
    }
});

// POST /api/config/import - 批量导入配置
configRouter.post('/import', async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserId(req);
        const { configs } = importSchema.parse(req.body);

        let imported = 0;
        for (const config of configs) {
            await prisma.configItem.upsert({
                where: { key: config.key },
                create: {
                    key: config.key,
                    value: config.value,
                    description: config.description,
                    category: config.key.split('_')[0]?.toLowerCase() || 'system',
                },
                update: {
                    value: config.value,
                    description: config.description,
                },
            });
            imported++;
        }

        res.json({ imported });
    } catch (error) {
        next(error);
    }
});

// PUT /api/config/batch - 批量更新配置
configRouter.put('/batch', async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserId(req);
        const { items } = batchUpdateSchema.parse(req.body);

        let updated = 0;
        for (const item of items) {
            await prisma.configItem.update({
                where: { key: item.key },
                data: { value: item.value },
            });
            updated++;
        }

        res.json({ updated });
    } catch (error) {
        next(error);
    }
});

// GET /api/config/:key - 获取单个配置项
configRouter.get('/:key', async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserId(req);
        const { key } = z.object({ key: z.string().min(1) }).parse(req.params);

        const config = await prisma.configItem.findUnique({
            where: { key },
        });

        if (!config) {
            throw createApiError('Config not found', 404, 'CONFIG_NOT_FOUND');
        }

        res.json(config);
    } catch (error) {
        next(error);
    }
});

// PUT /api/config/:key - 更新配置项
configRouter.put('/:key', async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserId(req);
        const { key } = z.object({ key: z.string().min(1) }).parse(req.params);
        const { value, description } = updateSchema.parse(req.body);

        const existing = await prisma.configItem.findUnique({
            where: { key },
        });

        if (!existing) {
            throw createApiError('Config not found', 404, 'CONFIG_NOT_FOUND');
        }

        // 记录历史
        await prisma.configHistory.create({
            data: {
                configItemId: existing.id,
                oldValue: existing.value,
                newValue: value,
            },
        });

        const updated = await prisma.configItem.update({
            where: { key },
            data: {
                value,
                ...(description !== undefined ? { description } : {}),
            },
        });

        res.json(updated);
    } catch (error) {
        next(error);
    }
});

// GET /api/config/:key/history - 获取配置历史
configRouter.get('/:key/history', async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserId(req);
        const { key } = z.object({ key: z.string().min(1) }).parse(req.params);

        const configItem = await prisma.configItem.findUnique({
            where: { key },
        });

        if (!configItem) {
            throw createApiError('Config not found', 404, 'CONFIG_NOT_FOUND');
        }

        const history = await prisma.configHistory.findMany({
            where: { configItemId: configItem.id },
            orderBy: { changedAt: 'desc' },
        });

        res.json(history);
    } catch (error) {
        next(error);
    }
});

// POST /api/config/:key/rollback - 回滚配置
configRouter.post('/:key/rollback', async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserId(req);
        const { key } = z.object({ key: z.string().min(1) }).parse(req.params);
        const { historyId } = rollbackSchema.parse(req.body);

        const historyRecord = await prisma.configHistory.findUnique({
            where: { id: historyId },
        });

        if (!historyRecord) {
            throw createApiError('History record not found', 404, 'HISTORY_NOT_FOUND');
        }

        const updated = await prisma.configItem.update({
            where: { key },
            data: { value: historyRecord.oldValue },
        });

        res.json(updated);
    } catch (error) {
        next(error);
    }
});
