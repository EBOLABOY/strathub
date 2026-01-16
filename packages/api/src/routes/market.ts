/**
 * 市场数据路由
 * 
 * 提供实时价格数据
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authGuard, requireUserId } from '../middleware/auth-guard.js';
import { createApiError } from '../middleware/error-handler.js';
import { prisma } from '@crypto-strategy-hub/database';
import { getProviderFactory } from '@crypto-strategy-hub/market-data';
import { SUPPORTED_EXCHANGES, normalizeSupportedExchangeId } from '@crypto-strategy-hub/shared';

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

const providerFactory = getProviderFactory();

const tickerParamsSchema = z.object({
    symbol: z.string().min(1),
});

const botIdParamSchema = z.object({
    botId: z.string().uuid(),
});

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
        const { symbol: rawSymbol } = tickerParamsSchema.parse(req.params);
        let symbol: string;
        try {
            symbol = decodeURIComponent(rawSymbol);
        } catch {
            throw createApiError('Invalid symbol encoding', 400, 'BAD_REQUEST');
        }

        // 获取用户的第一个交易所账户来获取价格
        const account = await prisma.exchangeAccount.findFirst({
            where: { userId, exchange: { in: [...SUPPORTED_EXCHANGES] } },
            select: { id: true, exchange: true, isTestnet: true },
            orderBy: { createdAt: 'desc' },
        });

        if (!account) {
            throw createApiError('No exchange account found', 404, 'NO_ACCOUNT');
        }

        const exchangeId = normalizeSupportedExchangeId(account.exchange);
        if (!exchangeId) {
            throw createApiError(`Exchange not supported: ${account.exchange}`, 400, 'EXCHANGE_NOT_SUPPORTED');
        }

        const cacheKey = `ticker:${exchangeId}:${symbol}`;
        const cached = getCached<{ price: string; timestamp: number }>(cacheKey);
        if (cached) {
            res.json({ symbol, price: cached.price, timestamp: cached.timestamp });
            return;
        }

        // 使用 provider 获取价格
        const provider = await providerFactory.createProvider({
            id: account.id,
            exchange: exchangeId,
            isTestnet: account.isTestnet,
        });

        let ticker;
        try {
            ticker = await provider.getTicker(symbol);
        } catch (error) {
            throw createApiError(`Failed to get ticker: ${(error as Error).message}`, 503, 'EXCHANGE_UNAVAILABLE');
        }

        // 写入缓存
        const now = Date.now();
        setCache(cacheKey, { price: ticker.last, timestamp: now }, TICKER_CACHE_TTL);

        res.json({
            symbol,
            price: ticker.last,
            timestamp: now,
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
        const { botId } = botIdParamSchema.parse(req.params);

        const bot = await prisma.bot.findFirst({
            where: { id: botId, userId },
            include: {
                exchangeAccount: {
                    select: { id: true, exchange: true, isTestnet: true },
                },
            },
        });

        if (!bot) {
            throw createApiError('Bot not found', 404, 'BOT_NOT_FOUND');
        }

        const exchangeId = normalizeSupportedExchangeId(bot.exchangeAccount.exchange);
        if (!exchangeId) {
            throw createApiError(
                `Exchange not supported: ${bot.exchangeAccount.exchange}`,
                400,
                'EXCHANGE_NOT_SUPPORTED'
            );
        }

        let currentPrice: number;
        const cacheKey = `ticker:${exchangeId}:${bot.symbol}`;
        const cached = getCached<{ price: string; timestamp: number }>(cacheKey);

        if (cached) {
            currentPrice = parseFloat(cached.price);
        } else {
            const provider = await providerFactory.createProvider({
                id: bot.exchangeAccount.id,
                exchange: exchangeId,
                isTestnet: bot.exchangeAccount.isTestnet,
            });

            let ticker;
            try {
                ticker = await provider.getTicker(bot.symbol);
            } catch (error) {
                throw createApiError(`Failed to get ticker: ${(error as Error).message}`, 503, 'EXCHANGE_UNAVAILABLE');
            }
            currentPrice = parseFloat(ticker.last);

            // 写入缓存
            setCache(cacheKey, { price: ticker.last, timestamp: Date.now() }, TICKER_CACHE_TTL);
        }

        // 解析 Bot 配置获取触发价格
        let triggerInfo = null;
        try {
            const config = JSON.parse(bot.configJson);
            const trigger = config.trigger || {};

            const schemaVersion = Number.isFinite(config.schemaVersion) ? Math.trunc(config.schemaVersion) : 1;

            // 获取触发百分比
            const riseSell = parseFloat(trigger.riseSell || trigger.sellPercent || '0');
            const fallBuy = parseFloat(trigger.fallBuy || trigger.buyPercent || '0');

            // v1: percent points (e.g. 2 => 2%)
            // v2+: ratio (e.g. 0.02 => 2%)
            const riseSellRatio = schemaVersion >= 2 ? riseSell : riseSell / 100;
            const fallBuyRatio = schemaVersion >= 2 ? fallBuy : fallBuy / 100;

            // 计算触发价格（基于当前价格）
            const sellTriggerPrice = currentPrice * (1 + riseSellRatio);
            const buyTriggerPrice = currentPrice * (1 - fallBuyRatio);

            // 计算距离触发的百分比
            const sellDistance = riseSellRatio * 100;
            const buyDistance = fallBuyRatio * 100;

            triggerInfo = {
                sellTriggerPrice: sellTriggerPrice.toFixed(4),
                buyTriggerPrice: buyTriggerPrice.toFixed(4),
                sellDistance: sellDistance.toFixed(2),
                buyDistance: buyDistance.toFixed(2),
                riseSell: sellDistance,
                fallBuy: buyDistance,
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
        const { botId } = botIdParamSchema.parse(req.params);

        const bot = await prisma.bot.findFirst({
            where: { id: botId, userId },
            include: {
                exchangeAccount: {
                    select: { id: true, exchange: true, isTestnet: true },
                },
            },
        });

        if (!bot) {
            throw createApiError('Bot not found', 404, 'BOT_NOT_FOUND');
        }

        const exchangeId = normalizeSupportedExchangeId(bot.exchangeAccount.exchange);
        if (!exchangeId) {
            throw createApiError(
                `Exchange not supported: ${bot.exchangeAccount.exchange}`,
                400,
                'EXCHANGE_NOT_SUPPORTED'
            );
        }

        const provider = await providerFactory.createProvider({
            id: bot.exchangeAccount.id,
            exchange: exchangeId,
            isTestnet: bot.exchangeAccount.isTestnet,
        });

        let marketInfo;
        try {
            marketInfo = await provider.getMarketInfo(bot.symbol);
        } catch (error) {
            throw createApiError(`Failed to get market info: ${(error as Error).message}`, 503, 'EXCHANGE_UNAVAILABLE');
        }

        res.json({
            ...marketInfo,
            symbol: bot.symbol,
        });
    } catch (error) {
        next(error);
    }
});
