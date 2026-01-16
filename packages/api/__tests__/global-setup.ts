/**
 * Global Test Setup for API tests
 * 
 * 在测试运行前初始化测试数据库（只执行一次）
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const databaseDir = path.resolve(__dirname, '..', '..', 'database');
const prismaDir = path.resolve(databaseDir, 'prisma');
const dbFile = path.join(prismaDir, 'test-api.db');
const dbUrl = 'file:./test-api.db';

export default async function globalSetup(): Promise<() => Promise<void>> {
    // 设置环境变量
    process.env['DATABASE_URL'] = dbUrl;
    process.env['NODE_ENV'] = 'test';
    process.env['JWT_SECRET'] = 'test-jwt-secret';

    // 确保 workspace 依赖的 dist 是最新的（tests 运行时会从 package exports 读取 dist）
    // 只 build 纯 TS 包，避免把 Next.js 等重型 build 拉进来。
    const workspacesToBuild = [
        'packages/shared',
        'packages/ccxt-utils',
        'packages/database',
        'packages/security',
        'packages/market-data',
        'packages/exchange',
    ];

    for (const workspace of workspacesToBuild) {
        execSync(`npm -w ${workspace} run build`, {
            cwd: repoRoot,
            stdio: 'inherit',
            env: process.env,
        });
    }

    // 删除旧的测试数据库
    try {
        if (fs.existsSync(dbFile)) {
            fs.unlinkSync(dbFile);
        }
    } catch {
        // ignore
    }

    // 创建数据库文件
    try {
        fs.mkdirSync(prismaDir, { recursive: true });
        fs.closeSync(fs.openSync(dbFile, 'w'));
    } catch {
        // ignore
    }

    // 推送 schema 到测试数据库
    execSync('npx prisma db push --skip-generate', {
        cwd: databaseDir,
        stdio: 'inherit',
        env: {
            ...process.env,
            DATABASE_URL: dbUrl,
        },
    });

    console.log('[Test Setup] API test database initialized');

    return async () => {
        try {
            if (fs.existsSync(dbFile)) {
                fs.unlinkSync(dbFile);
            }
        } catch {
            // ignore
        }
    };
}
