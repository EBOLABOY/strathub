/**
 * Templates API Routes
 * 
 * 策略模板相关端点
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '@crypto-strategy-hub/database';
import { authGuard, requireUserId } from '../middleware/auth-guard.js';
import { randomUUID } from 'crypto';

export const templatesRouter = Router();

// 所有模板路由需要认证
templatesRouter.use(authGuard);

// GET /api/templates - 获取所有模板
templatesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const templates = await prisma.configTemplate.findMany({
            orderBy: { updatedAt: 'desc' },
        });

        res.json(templates);
    } catch (error) {
        next(error);
    }
});

// POST /api/templates - 创建模板
templatesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserId(req);
        const { name, description, configJson } = req.body;

        if (!name || !configJson) {
            res.status(400).json({ error: 'Missing required fields', code: 'MISSING_FIELDS' });
            return;
        }

        // 验证 JSON 格式
        try {
            JSON.parse(configJson);
        } catch {
            res.status(400).json({ error: 'Invalid JSON format', code: 'INVALID_JSON' });
            return;
        }

        const template = await prisma.configTemplate.create({
            data: {
                id: randomUUID(),
                name,
                description,
                configJson,
            },
        });

        res.status(201).json(template);
    } catch (error) {
        next(error);
    }
});

// GET /api/templates/:id - 获取单个模板
templatesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const template = await prisma.configTemplate.findUnique({
            where: { id },
        });

        if (!template) {
            res.status(404).json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' });
            return;
        }

        res.json(template);
    } catch (error) {
        next(error);
    }
});

// PUT /api/templates/:id - 更新模板
templatesRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserId(req);
        const { id } = req.params;
        const { name, description, configJson } = req.body;

        const existing = await prisma.configTemplate.findUnique({
            where: { id },
        });

        if (!existing) {
            res.status(404).json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' });
            return;
        }

        // 验证 JSON 格式（如果提供）
        if (configJson) {
            try {
                JSON.parse(configJson);
            } catch {
                res.status(400).json({ error: 'Invalid JSON format', code: 'INVALID_JSON' });
                return;
            }
        }

        const updated = await prisma.configTemplate.update({
            where: { id },
            data: {
                ...(name !== undefined ? { name } : {}),
                ...(description !== undefined ? { description } : {}),
                ...(configJson !== undefined ? { configJson } : {}),
            },
        });

        res.json(updated);
    } catch (error) {
        next(error);
    }
});

// DELETE /api/templates/:id - 删除模板
templatesRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserId(req);
        const { id } = req.params;

        const existing = await prisma.configTemplate.findUnique({
            where: { id },
        });

        if (!existing) {
            res.status(404).json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' });
            return;
        }

        await prisma.configTemplate.delete({
            where: { id },
        });

        res.status(204).send();
    } catch (error) {
        next(error);
    }
});

// POST /api/templates/:id/apply - 应用模板到 Bot
templatesRouter.post('/:id/apply', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = requireUserId(req);
        const { id } = req.params;
        const { botId } = req.body;

        if (!botId) {
            res.status(400).json({ error: 'Missing botId', code: 'MISSING_BOT_ID' });
            return;
        }

        // 获取模板
        const template = await prisma.configTemplate.findUnique({
            where: { id },
        });

        if (!template) {
            res.status(404).json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' });
            return;
        }

        // 获取 Bot（必须是用户自己的）
        const bot = await prisma.bot.findFirst({
            where: { id: botId, userId },
        });

        if (!bot) {
            res.status(404).json({ error: 'Bot not found', code: 'BOT_NOT_FOUND' });
            return;
        }

        // 只有 DRAFT 或 STOPPED 状态的 Bot 才能应用模板
        if (!['DRAFT', 'STOPPED'].includes(bot.status)) {
            res.status(400).json({
                error: 'Can only apply template to DRAFT or STOPPED bots',
                code: 'INVALID_BOT_STATUS',
            });
            return;
        }

        // 更新 Bot 配置
        const updated = await prisma.bot.update({
            where: { id: botId },
            data: {
                configJson: template.configJson,
                configRevision: bot.configRevision + 1,
            },
        });

        res.json(updated);
    } catch (error) {
        next(error);
    }
});
