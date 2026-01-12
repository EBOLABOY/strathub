/**
 * Auth Routes - 登录/注册
 */

import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@crypto-strategy-hub/database';
import { createApiError } from '../middleware/error-handler.js';

export const authRouter = Router();

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production';

// Schemas
const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

// POST /api/auth/register
authRouter.post('/register', async (req, res, next) => {
    try {
        const { email, password } = registerSchema.parse(req.body);

        // 检查用户是否已存在
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            throw createApiError('Email already exists', 409, 'EMAIL_EXISTS');
        }

        // 创建用户
        const passwordHash = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: { email, passwordHash },
            select: { id: true, email: true, role: true, createdAt: true },
        });

        res.status(201).json(user);
    } catch (error) {
        next(error);
    }
});

// POST /api/auth/login
authRouter.post('/login', async (req, res, next) => {
    try {
        const { email, password } = loginSchema.parse(req.body);

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            throw createApiError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
            throw createApiError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            user: { id: user.id, email: user.email, role: user.role },
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/auth/me
authRouter.get('/me', async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
        }

        const token = authHeader.slice(7);
        const payload = jwt.verify(token, JWT_SECRET) as { userId: string };

        const user = await prisma.user.findUnique({
            where: { id: payload.userId },
            select: { id: true, email: true, role: true, createdAt: true },
        });

        if (!user) {
            throw createApiError('User not found', 404, 'USER_NOT_FOUND');
        }

        res.json(user);
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            next(createApiError('Invalid token', 401, 'INVALID_TOKEN'));
        } else {
            next(error);
        }
    }
});
