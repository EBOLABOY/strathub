/**
 * JWT Auth Middleware
 * 
 * 替换 x-user-id 临时 hack
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createApiError } from './error-handler.js';
import { getJwtSecret } from '../env.js';

const JWT_SECRET = getJwtSecret();

export interface JwtPayload {
    userId: string;
    email: string;
    role: 'admin' | 'user';
}

export function verifyJwtToken(token: string): JwtPayload {
    try {
        return jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            throw createApiError('Invalid token', 401, 'INVALID_TOKEN');
        }
        throw error;
    }
}

// 扩展 Express Request 类型
declare global {
    namespace Express {
        interface Request {
            user?: JwtPayload;
        }
    }
}

/**
 * JWT 认证中间件
 * 
 * 从 Authorization header 提取并验证 JWT，
 * 将解析后的 payload 挂载到 req.user
 */
export function authGuard(req: Request, _res: Response, next: NextFunction): void {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith('Bearer ')) {
            throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
        }

        const token = authHeader.slice(7);
        req.user = verifyJwtToken(token);
        next();
    } catch (error) {
        next(error);
    }
}

/**
 * 可选认证中间件
 * 
 * 如果有 token 则解析，没有则继续
 */
export function optionalAuthGuard(req: Request, _res: Response, next: NextFunction): void {
    try {
        const authHeader = req.headers.authorization;

        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.slice(7);
            req.user = verifyJwtToken(token);
        }

        next();
    } catch {
        // token 无效时静默继续
        next();
    }
}

/**
 * 获取当前用户 ID
 * 
 * 如果未认证则抛出错误
 */
export function requireUserId(req: Request): string {
    if (!req.user?.userId) {
        throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
    }
    return req.user.userId;
}
