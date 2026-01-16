/**
 * Templates API Routes
 * 
 * 策略模板相关端点
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '@crypto-strategy-hub/database';
import { authGuard, requireUserId } from '../middleware/auth-guard.js';
import { randomUUID } from 'crypto';
import { createApiError } from '../middleware/error-handler.js';

export const templatesRouter = Router();

// 所有模板路由需要认证
templatesRouter.use(authGuard);

const templateIdSchema = z.object({ id: z.string().uuid() });

const templateCreateSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    configJson: z.string().min(1).refine((value) => {
        try {
            JSON.parse(value);
            return true;
        } catch {
            return false;
        }
    }, { message: 'Invalid JSON format' }),
});

const templateUpdateSchema = z
    .object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        configJson: z
            .string()
            .min(1)
            .refine((value) => {
                try {
                    JSON.parse(value);
                    return true;
                } catch {
                    return false;
                }
            }, { message: 'Invalid JSON format' })
            .optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

const applySchema = z.object({ botId: z.string().uuid() });

// GET /api/templates - 获取所有模板
templatesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        requireUserId(req);
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
        const { name, description, configJson } = templateCreateSchema.parse(req.body);

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
        requireUserId(req);
        const { id } = templateIdSchema.parse(req.params);

        const template = await prisma.configTemplate.findUnique({
            where: { id },
        });

        if (!template) {
            throw createApiError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
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
        const { id } = templateIdSchema.parse(req.params);
        const { name, description, configJson } = templateUpdateSchema.parse(req.body);

        const existing = await prisma.configTemplate.findUnique({
            where: { id },
        });

        if (!existing) {
            throw createApiError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
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
        const { id } = templateIdSchema.parse(req.params);

        const existing = await prisma.configTemplate.findUnique({
            where: { id },
        });

        if (!existing) {
            throw createApiError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
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
        const { id } = templateIdSchema.parse(req.params);
        const { botId } = applySchema.parse(req.body);

        // 获取模板
        const template = await prisma.configTemplate.findUnique({
            where: { id },
        });

        if (!template) {
            throw createApiError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
        }

        // 获取 Bot（必须是用户自己的）
        const bot = await prisma.bot.findFirst({
            where: { id: botId, userId },
        });

        if (!bot) {
            throw createApiError('Bot not found', 404, 'BOT_NOT_FOUND');
        }

        // 只有 DRAFT 或 STOPPED 状态的 Bot 才能应用模板
        if (!['DRAFT', 'STOPPED'].includes(bot.status)) {
            throw createApiError('Can only apply template to DRAFT or STOPPED bots', 400, 'INVALID_BOT_STATUS');
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
