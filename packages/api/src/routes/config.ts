/**
 * Config API Routes
 * 
 * 配置中心相关端点
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '@crypto-strategy-hub/database';
import { authGuard } from '../middleware/auth-guard.js';

export const configRouter = Router();

// 所有配置路由需要认证
configRouter.use(authGuard);

// GET /api/config - 获取所有配置项
configRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
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
        const { configs } = req.body as { configs: { key: string; value: string; description?: string }[] };

        if (!Array.isArray(configs)) {
            res.status(400).json({ error: 'Invalid configs format', code: 'INVALID_FORMAT' });
            return;
        }

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
        const { items } = req.body as { items: { key: string; value: string }[] };

        if (!Array.isArray(items)) {
            res.status(400).json({ error: 'Invalid items format', code: 'INVALID_FORMAT' });
            return;
        }

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
        const { key } = req.params;

        const config = await prisma.configItem.findUnique({
            where: { key },
        });

        if (!config) {
            res.status(404).json({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
            return;
        }

        res.json(config);
    } catch (error) {
        next(error);
    }
});

// PUT /api/config/:key - 更新配置项
configRouter.put('/:key', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { key } = req.params;
        const { value, description } = req.body;

        const existing = await prisma.configItem.findUnique({
            where: { key },
        });

        if (!existing) {
            res.status(404).json({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
            return;
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
        const { key } = req.params;

        const configItem = await prisma.configItem.findUnique({
            where: { key },
        });

        if (!configItem) {
            res.status(404).json({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
            return;
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
        const { key } = req.params;
        const { historyId } = req.body;

        const historyRecord = await prisma.configHistory.findUnique({
            where: { id: historyId },
        });

        if (!historyRecord) {
            res.status(404).json({ error: 'History record not found', code: 'HISTORY_NOT_FOUND' });
            return;
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
