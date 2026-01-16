/**
 * Dashboard Routes
 * 
 * 提供仪表板统计数据和历史曲线数据接口
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '@crypto-strategy-hub/database';
import { BotStatus, normalizeSupportedExchangeId, supportsTestnet, requiresPassphrase } from '@crypto-strategy-hub/shared';
import { createApiError } from '../middleware/error-handler.js';
import { authGuard, requireUserId } from '../middleware/auth-guard.js';
import { createCcxtExecutor } from '@crypto-strategy-hub/exchange';
import { decryptCredentials, isEncryptedFormat } from '@crypto-strategy-hub/security';

// ============================================================================
// Types
// ============================================================================

interface DashboardStats {
    totalAssets: number;
    totalAssetsTrend: string;
    activeBots: number;
    totalBots: number;
    winRate: string;
    winRateTrend: string;
    volume24h: number;
    volume24hTrend: string;
    pnl24h: Record<string, number>;
}

interface ChartDataPoint {
    name: string;
    value: number;
}

type StoredCredentials = { apiKey: string; secret: string; passphrase?: string };

function parseStoredCredentials(raw: string): StoredCredentials {
    const json = isEncryptedFormat(raw) ? decryptCredentials(raw) : raw;
    return JSON.parse(json) as StoredCredentials;
}

// ============================================================================
// Schemas
// ============================================================================

const chartQuerySchema = z.object({
    period: z.enum(['1h', '1d', '1w', '1m', '1y']).optional().default('1d'),
});

// ============================================================================
// Router
// ============================================================================

export const dashboardRouter = Router();

// 所有路由需要认证
dashboardRouter.use(authGuard);

/**
 * GET /api/dashboard/stats
 * 返回仪表板统计数据
 */
dashboardRouter.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = requireUserId(req);

        // 并行获取数据
        const [accounts, bots, recentTrades] = await Promise.all([
            prisma.exchangeAccount.findMany({ where: { userId } }),
            prisma.bot.findMany({ where: { userId } }),
            // 获取过去 24 小时的交易
            prisma.trade.findMany({
                where: {
                    bot: { userId },
                    timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                },
                include: { bot: { select: { id: true } } },
            }),
        ]);

        // 计算总资产 (从各账户余额获取)
        let totalAssets = 0;
        const stablecoins = ['USDT', 'BUSD', 'USDC', 'FDUSD', 'DAI'];
        const allowMainnet = process.env['ALLOW_MAINNET_TRADING'] === 'true';

        for (const account of accounts) {
            try {
                const exchangeId = normalizeSupportedExchangeId(account.exchange);
                if (!exchangeId) continue;

                // Skip testnet accounts with unsupported testnet
                if (account.isTestnet && !supportsTestnet(exchangeId)) continue;

                // Skip mainnet accounts when mainnet is disabled
                if (!account.isTestnet && !allowMainnet) continue;

                let creds: StoredCredentials;
                try {
                    creds = parseStoredCredentials(account.encryptedCredentials);
                } catch {
                    continue;
                }

                if (!creds.apiKey || !creds.secret) continue;
                if (requiresPassphrase(exchangeId) && !creds.passphrase) continue;

                const executor = createCcxtExecutor({
                    exchangeId,
                    apiKey: creds.apiKey,
                    secret: creds.secret,
                    passphrase: creds.passphrase,
                    isTestnet: account.isTestnet,
                    allowMainnet,
                });

                const balances = await executor.fetchBalance();

                for (const [asset, balance] of Object.entries(balances)) {
                    if (stablecoins.includes(asset)) {
                        totalAssets += parseFloat(balance.total);
                    }
                }
            } catch (err) {
                console.warn(`Failed to fetch balance for account ${account.id}:`, err);
            }
        }

        // 计算活跃 Bot 数量
        const activeBots = bots.filter(
            bot =>
                bot.status === BotStatus.RUNNING ||
                bot.status === BotStatus.WAITING_TRIGGER ||
                bot.status === BotStatus.PAUSED
        ).length;

        // 计算 24h 交易量
        const volume24h = recentTrades.reduce((sum, trade) => {
            const price = parseFloat(trade.price);
            const amount = parseFloat(trade.amount);
            return sum + price * amount;
        }, 0);

        // 计算每个 Bot 的 24h PnL
        const pnl24h: Record<string, number> = {};
        for (const bot of bots) {
            const botTrades = recentTrades.filter(t => t.bot.id === bot.id);
            let pnl = 0;
            for (const trade of botTrades) {
                const price = parseFloat(trade.price);
                const amount = parseFloat(trade.amount);
                const fee = parseFloat(trade.fee);
                // 简化计算：卖出为正收益，买入为负支出
                if (trade.side === 'sell') {
                    pnl += price * amount - fee;
                } else {
                    pnl -= price * amount + fee;
                }
            }
            if (botTrades.length > 0) {
                pnl24h[bot.id] = pnl;
            }
        }

        // 获取昨日交易量用于计算趋势
        const yesterdayTrades = await prisma.trade.findMany({
            where: {
                bot: { userId },
                timestamp: {
                    gte: new Date(Date.now() - 48 * 60 * 60 * 1000),
                    lt: new Date(Date.now() - 24 * 60 * 60 * 1000),
                },
            },
        });

        const volumeYesterday = yesterdayTrades.reduce((sum, trade) => {
            const price = parseFloat(trade.price);
            const amount = parseFloat(trade.amount);
            return sum + price * amount;
        }, 0);

        // 计算交易量趋势
        let volume24hTrend = '--';
        if (volumeYesterday > 0) {
            const change = ((volume24h - volumeYesterday) / volumeYesterday) * 100;
            volume24hTrend = change >= 0 ? `+${change.toFixed(1)}%` : `${change.toFixed(1)}%`;
        } else if (volume24h > 0) {
            volume24hTrend = '+100%';
        }

        const stats: DashboardStats = {
            totalAssets,
            totalAssetsTrend: '--', // 需要历史数据才能计算
            activeBots,
            totalBots: bots.length,
            winRate: '--', // 待实现：需要成本基础计算
            winRateTrend: '--',
            volume24h,
            volume24hTrend,
            pnl24h,
        };

        res.json(stats);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/dashboard/chart
 * 返回历史曲线数据
 */
dashboardRouter.get('/chart', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = requireUserId(req);
        const { period } = chartQuerySchema.parse(req.query);

        // 根据周期确定数据点数量和时间间隔
        const periodConfig: Record<string, { points: number; intervalMs: number; format: (i: number) => string }> = {
            '1h': { points: 12, intervalMs: 5 * 60 * 1000, format: (i) => `${i * 5}m` },
            '1d': { points: 24, intervalMs: 60 * 60 * 1000, format: (i) => `${i}h` },
            '1w': { points: 7, intervalMs: 24 * 60 * 60 * 1000, format: (i) => `D${i + 1}` },
            '1m': { points: 30, intervalMs: 24 * 60 * 60 * 1000, format: (i) => `${i + 1}` },
            '1y': { points: 12, intervalMs: 30 * 24 * 60 * 60 * 1000, format: (i) => `M${i + 1}` },
        };

        const config = periodConfig[period]!;

        // 获取当前总资产作为基准
        const accounts = await prisma.exchangeAccount.findMany({ where: { userId } });
        let currentAssets = 0;
        const stablecoins = ['USDT', 'BUSD', 'USDC', 'FDUSD', 'DAI'];
        const allowMainnet = process.env['ALLOW_MAINNET_TRADING'] === 'true';

        for (const account of accounts) {
            try {
                const exchangeId = normalizeSupportedExchangeId(account.exchange);
                if (!exchangeId) continue;

                if (account.isTestnet && !supportsTestnet(exchangeId)) continue;
                if (!account.isTestnet && !allowMainnet) continue;

                let creds: StoredCredentials;
                try {
                    creds = parseStoredCredentials(account.encryptedCredentials);
                } catch {
                    continue;
                }

                if (!creds.apiKey || !creds.secret) continue;
                if (requiresPassphrase(exchangeId) && !creds.passphrase) continue;

                const executor = createCcxtExecutor({
                    exchangeId,
                    apiKey: creds.apiKey,
                    secret: creds.secret,
                    passphrase: creds.passphrase,
                    isTestnet: account.isTestnet,
                    allowMainnet,
                });

                const balances = await executor.fetchBalance();

                for (const [asset, balance] of Object.entries(balances)) {
                    if (stablecoins.includes(asset)) {
                        currentAssets += parseFloat(balance.total);
                    }
                }
            } catch (err) {
                // 忽略失败的账户
            }
        }

        // 获取历史交易数据来推算历史资产变化
        const startTime = new Date(Date.now() - config.points * config.intervalMs);
        const trades = await prisma.trade.findMany({
            where: {
                bot: { userId },
                timestamp: { gte: startTime },
            },
            orderBy: { timestamp: 'desc' },
        });

        // 构建曲线数据（从现在往回推算）
        const data: ChartDataPoint[] = [];
        let runningAssets = currentAssets;

        for (let i = config.points - 1; i >= 0; i--) {
            const pointTime = Date.now() - i * config.intervalMs;
            const nextPointTime = Date.now() - (i - 1) * config.intervalMs;

            // 找出这个时间段内的交易，反向计算资产变化
            const periodTrades = trades.filter(t => {
                const ts = new Date(t.timestamp).getTime();
                return ts >= pointTime && ts < nextPointTime;
            });

            // 反向扣除这些交易对资产的影响
            for (const trade of periodTrades) {
                const price = parseFloat(trade.price);
                const amount = parseFloat(trade.amount);
                const fee = parseFloat(trade.fee);
                if (trade.side === 'sell') {
                    runningAssets -= price * amount - fee;
                } else {
                    runningAssets += price * amount + fee;
                }
            }

            data.push({
                name: config.format(config.points - 1 - i),
                value: Math.max(0, runningAssets),
            });
        }

        // 反转使得时间从旧到新
        data.reverse();

        res.json(data);
    } catch (error) {
        next(error);
    }
});
