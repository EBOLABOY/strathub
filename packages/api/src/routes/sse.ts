/**
 * SSE (Server-Sent Events) 路由
 * 
 * GET /api/sse?topics=botStatus,botLog&token=xxx
 * 
 * 支持的事件类型：
 * - botStatus: Bot 状态变更
 * - botLog: Bot 运行日志
 * - config: 配置变更
 */

import { Router, Request, Response } from 'express';
import { prisma } from '@crypto-strategy-hub/database';
import jwt from 'jsonwebtoken';

export const sseRouter = Router();

// 存储活跃的 SSE 连接
interface SSEClient {
    id: string;
    userId: string;
    topics: string[];
    res: Response;
    lastHeartbeat: number;
}

const clients = new Map<string, SSEClient>();

// 心跳间隔（毫秒）
const HEARTBEAT_INTERVAL = 30000;

// 发送 SSE 事件到指定客户端
function sendEvent(client: SSEClient, type: string, data: unknown): void {
    try {
        const event = {
            type,
            data,
            timestamp: new Date().toISOString(),
        };
        client.res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
        console.error(`[SSE] Failed to send event to ${client.id}:`, err);
    }
}

// 广播事件到所有订阅了该 topic 的客户端
export function broadcastEvent(topic: string, data: unknown, userId?: string): void {
    for (const client of clients.values()) {
        // 检查是否订阅了该 topic
        if (!client.topics.includes(topic)) continue;

        // 如果指定了 userId，只发送给该用户
        if (userId && client.userId !== userId) continue;

        sendEvent(client, topic, data);
    }
}

// SSE 连接端点
sseRouter.get('/', async (req: Request, res: Response) => {
    // 验证 token
    const token = req.query['token'] as string;
    if (!token) {
        res.status(401).json({ error: 'Missing token' });
        return;
    }

    let userId: string;
    try {
        const secret = process.env['JWT_SECRET'] || 'dev-secret';
        const decoded = jwt.verify(token, secret) as { userId: string };
        userId = decoded.userId;
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
        return;
    }

    // 验证用户存在
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        res.status(401).json({ error: 'User not found' });
        return;
    }

    // 解析订阅的 topics
    const topicsParam = req.query['topics'] as string || 'botStatus';
    const topics = topicsParam.split(',').filter(Boolean);

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Nginx 兼容
    res.flushHeaders();

    // 创建客户端记录
    const clientId = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const client: SSEClient = {
        id: clientId,
        userId,
        topics,
        res,
        lastHeartbeat: Date.now(),
    };
    clients.set(clientId, client);

    // console.log(`[SSE] Client connected: ${clientId}, topics: ${topics.join(',')}`);

    // 发送初始连接确认
    sendEvent(client, 'connected', { clientId, topics });

    // 发送当前 Bot 状态（如果订阅了 botStatus）
    if (topics.includes('botStatus')) {
        try {
            const bots = await prisma.bot.findMany({
                where: { userId },
                select: {
                    id: true,
                    status: true,
                    statusVersion: true,
                    runId: true,
                    lastError: true,
                },
            });

            for (const bot of bots) {
                sendEvent(client, 'botStatus', {
                    botId: bot.id,
                    status: bot.status,
                    statusVersion: bot.statusVersion,
                    runId: bot.runId,
                    lastError: bot.lastError,
                });
            }
        } catch (err) {
            console.error('[SSE] Failed to send initial bot statuses:', err);
        }
    }

    // 心跳定时器
    const heartbeatTimer = setInterval(() => {
        try {
            res.write(': heartbeat\n\n');
            client.lastHeartbeat = Date.now();
        } catch (err) {
            console.error(`[SSE] Heartbeat failed for ${clientId}:`, err);
            clearInterval(heartbeatTimer);
            clients.delete(clientId);
        }
    }, HEARTBEAT_INTERVAL);

    // 连接关闭处理
    req.on('close', () => {
        // console.log(`[SSE] Client disconnected: ${clientId}`);
        clearInterval(heartbeatTimer);
        clients.delete(clientId);
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
        // ECONNRESET 是正常的连接关闭，只在调试时记录
        if (err.code !== 'ECONNRESET') {
            console.error(`[SSE] Client error ${clientId}:`, err);
        }
        clearInterval(heartbeatTimer);
        clients.delete(clientId);
    });
});

// 获取连接状态（调试用）
sseRouter.get('/status', (_req: Request, res: Response) => {
    const clientList = Array.from(clients.values()).map(c => ({
        id: c.id,
        userId: c.userId,
        topics: c.topics,
        connected: Date.now() - c.lastHeartbeat < HEARTBEAT_INTERVAL * 2,
    }));

    res.json({
        clients: clientList.length,
        list: clientList,
    });
});

// 导出广播函数供其他模块使用
export { broadcastEvent as emitSSE };
