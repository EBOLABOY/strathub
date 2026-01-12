/**
 * Prisma Client Singleton
 */

import { PrismaClient } from '@prisma/client';

declare global {
    // eslint-disable-next-line no-var
    var __prisma: PrismaClient | undefined;
}

/**
 * 创建 Prisma Client 单例
 * 
 * 在开发环境中使用全局变量防止热重载时创建多个连接
 */
export function createPrismaClient(): PrismaClient {
    if (globalThis.__prisma) {
        return globalThis.__prisma;
    }

    const client = new PrismaClient({
        log: process.env['NODE_ENV'] === 'development'
            ? ['query', 'error', 'warn']
            : ['error'],
    });

    if (process.env['NODE_ENV'] !== 'production') {
        globalThis.__prisma = client;
    }

    return client;
}

/** 默认 Prisma Client 实例 */
export const prisma = createPrismaClient();

export { PrismaClient } from '@prisma/client';
