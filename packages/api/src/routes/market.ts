/**
 * 市场数据路由
 * 
 * 提供实时价格数据
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authGuard, requireUserId } from '../middleware/auth-guard.js';
import { prisma } from '@crypto-strategy-hub/database';
import { createBinanceProvider } from '@crypto-strategy-hub/market-data';

export const marketRouter = Router();

// 简单内存缓存
interface CacheEntry<T> {
    data: T;
    expiry: number;
}
const cache = new Map<string, CacheEntry<any>>();

function getCached<T>(key: string): T | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
        cache.delete(key);
        return null;
    }
    return entry.data as T;
}

function setCache<T>(key: string, data: T, ttlMs: number) {
    cache.set(key, { data, expiry: Date.now() + ttlMs });
}

const TICKER_CACHE_TTL = 2000; // 2秒缓存

// 应用认证中间件
marketRouter.use(authGuard);

/**
 * GET /api/market/ticker/:symbol
 * 
 * 获取交易对的实时价格
 */
marketRouter.get('/ticker/:symbol', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = requireUserId(req);
        const symbol = decodeURIComponent(req.params['symbol'] || '');

        if (!symbol) {
            res.status(400).json({ error: 'Symbol is required', code: 'MISSING_SYMBOL' });
            return;
        }

        const cacheKey = `ticker:${symbol}`;
        const cached = getCached<{ price: string; timestamp: number }>(cacheKey);

        if (cached) {
            res.json({
                symbol,
                price: cached.price,
                timestamp: cached.timestamp,
            });
            return;
        }

        // 获取用户的第一个交易所账户来获取价格
        const account = await prisma.exchangeAccount.findFirst({
            where: { userId },
            select: { id: true, exchange: true, isTestnet: true },
        });

        if (!account) {
            res.status(404).json({ error: 'No exchange account found', code: 'NO_ACCOUNT' });
            return;
        }

        // 使用 provider 获取价格
        const provider = await createBinanceProvider({
            id: account.id,
            exchange: account.exchange,
            isTestnet: account.isTestnet,
        });

        const ticker = await provider.getTicker(symbol);

        // 写入缓存
        setCache(cacheKey, { price: ticker.last, timestamp: Date.now() }, TICKER_CACHE_TTL);

        res.json({
            symbol,
            price: ticker.last,
            timestamp: Date.now(),
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/market/bot/:botId/ticker
 * 
 * 获取 Bot 交易对的实时价格及触发信息
 */
marketRouter.get('/bot/:botId/ticker', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = requireUserId(req);
        const { botId } = req.params;

        const bot = await prisma.bot.findFirst({
            where: { id: botId, userId },
            include: {
                exchangeAccount: {
                    select: { id: true, exchange: true, isTestnet: true },
                },
            },
        });

        if (!bot) {
            res.status(404).json({ error: 'Bot not found', code: 'BOT_NOT_FOUND' });
            return;
        }

        let currentPrice: number;
        const cacheKey = `ticker:${bot.symbol}`;
        const cached = getCached<{ price: string; timestamp: number }>(cacheKey);

        if (cached) {
            currentPrice = parseFloat(cached.price);
        } else {
            const provider = await createBinanceProvider({
                id: bot.exchangeAccount.id,
                exchange: bot.exchangeAccount.exchange,
                isTestnet: bot.exchangeAccount.isTestnet,
            });

            const ticker = await provider.getTicker(bot.symbol);
            currentPrice = parseFloat(ticker.last);

            // 写入缓存
            setCache(cacheKey, { price: ticker.last, timestamp: Date.now() }, TICKER_CACHE_TTL);
        }

        // 解析 Bot 配置获取触发价格
        let triggerInfo = null;
        try {
            const config = JSON.parse(bot.configJson);
            const trigger = config.trigger || {};

            // 获取触发百分比
            const riseSell = parseFloat(trigger.riseSell || trigger.sellPercent || '0');
            const fallBuy = parseFloat(trigger.fallBuy || trigger.buyPercent || '0');

            // 计算触发价格（基于当前价格）
            const sellTriggerPrice = currentPrice * (1 + riseSell / 100);
            const buyTriggerPrice = currentPrice * (1 - fallBuy / 100);

            // 计算距离触发的百分比
            const sellDistance = riseSell;
            const buyDistance = fallBuy;

            triggerInfo = {
                sellTriggerPrice: sellTriggerPrice.toFixed(4),
                buyTriggerPrice: buyTriggerPrice.toFixed(4),
                sellDistance: sellDistance.toFixed(2),
                buyDistance: buyDistance.toFixed(2),
                riseSell,
                fallBuy,
            };
        } catch {
            // 解析失败忽略
        }

        res.json({
            symbol: bot.symbol,
            price: currentPrice,
            priceFormatted: currentPrice.toFixed(4),
            timestamp: Date.now(),
            triggerInfo,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/market/bot/:botId/market-info
 * 
 * 获取 Bot 交易对的市场信息
 */
marketRouter.get('/bot/:botId/market-info', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = requireUserId(req);
        const { botId } = req.params;

        const bot = await prisma.bot.findFirst({
            where: { id: botId, userId },
            include: {
                exchangeAccount: {
                    select: { id: true, exchange: true, isTestnet: true },
                },
            },
        });

        if (!bot) {
            res.status(404).json({ error: 'Bot not found', code: 'BOT_NOT_FOUND' });
            return;
        }

        const provider = await createBinanceProvider({
            id: bot.exchangeAccount.id,
            exchange: bot.exchangeAccount.exchange,
            isTestnet: bot.exchangeAccount.isTestnet,
        });

        const marketInfo = await provider.getMarketInfo(bot.symbol);

        res.json({
            ...marketInfo,
            symbol: bot.symbol,
        });
    } catch (error) {
        next(error);
    }
});
