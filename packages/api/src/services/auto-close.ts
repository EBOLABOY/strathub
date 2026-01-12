/**
 * AutoClose Service - ACC-RISK-002 运行时逻辑
 * 
 * 职责：
 * 1. 冻结 referencePrice（start/resume 时）
 * 2. CAS 触发 RISK_TRIGGERED(AUTO_CLOSE)
 */

import { prisma, Prisma } from '@crypto-strategy-hub/database';
import { BotStatus } from '@crypto-strategy-hub/shared';
import {
    checkAutoClose,
    parseAutoCloseConfig,
    getReferencePrice,
} from '@crypto-strategy-hub/shared';
import { createApiError } from '../middleware/error-handler.js';
import type { MarketDataProvider } from '@crypto-strategy-hub/market-data';

export interface AutoCloseCheckResult {
    triggered: boolean;
    previouslyTriggered: boolean;
    newStatus?: string;
    drawdownPercent?: string;
}

/**
 * 执行 AutoClose 检查并触发（CAS 幂等）
 * 
 * @param botId Bot ID
 * @param userId 用户 ID（安全校验）
 * @param provider Market Data Provider
 * @returns 检查结果
 */
export async function checkAndTriggerAutoClose(
    botId: string,
    userId: string,
    provider: MarketDataProvider
): Promise<AutoCloseCheckResult> {
    // 1. 获取 bot（不需要事务，只是读取）
    const bot = await prisma.bot.findFirst({
        where: { id: botId, userId },
        select: {
            id: true,
            status: true,
            statusVersion: true,
            symbol: true,
            configJson: true,
            autoCloseReferencePrice: true,
            autoCloseTriggeredAt: true,
        },
    });

    if (!bot) {
        throw createApiError('Bot not found', 404, 'BOT_NOT_FOUND');
    }

    // 2. 只有 RUNNING/WAITING_TRIGGER 才检查
    if (bot.status !== BotStatus.RUNNING && bot.status !== BotStatus.WAITING_TRIGGER) {
        return { triggered: false, previouslyTriggered: false };
    }

    // 3. 已经触发过
    if (bot.autoCloseTriggeredAt) {
        return { triggered: false, previouslyTriggered: true };
    }

    // 4. 没有冻结的参考价（不应该发生，但防御性处理）
    if (!bot.autoCloseReferencePrice) {
        return { triggered: false, previouslyTriggered: false };
    }

    // 5. 解析配置
    const config = parseAutoCloseConfig(bot.configJson);
    if (!config.enableAutoClose) {
        return { triggered: false, previouslyTriggered: false };
    }

    // 6. 获取当前价格（I/O 在事务外）
    let ticker;
    try {
        ticker = await provider.getTicker(bot.symbol);
    } catch (error) {
        throw createApiError(
            `Failed to get ticker: ${(error as Error).message}`,
            503,
            'EXCHANGE_UNAVAILABLE'
        );
    }

    // 7. 纯函数判定（捕获价格解析异常）
    let result;
    try {
        result = checkAutoClose(config, {
            referencePrice: bot.autoCloseReferencePrice,
            lastPrice: ticker.last,
            alreadyTriggered: false, // 已在步骤 3 检查
        });
    } catch (error) {
        // 价格解析失败 = 行情数据异常，当 503 处理
        // 日志记录详细信息（生产环境可接入日志系统）
        console.error('[AutoClose] Invalid price data:', (error as Error).message);
        throw createApiError(
            'Invalid price data from exchange',
            503,
            'EXCHANGE_UNAVAILABLE'
        );
    }

    if (!result.shouldTrigger) {
        return { triggered: false, previouslyTriggered: false };
    }

    // 8. CAS 触发（事务很小，只做写入）
    const now = new Date();
    try {
        await prisma.bot.update({
            where: {
                id: botId,
                statusVersion: bot.statusVersion,
                autoCloseTriggeredAt: null, // CAS 条件：未触发过
            },
            data: {
                status: BotStatus.STOPPING,
                statusVersion: bot.statusVersion + 1,
                autoCloseTriggeredAt: now,
                autoCloseReason: 'AUTO_CLOSE',
                lastError: `AUTO_CLOSE triggered: drawdown ${result.drawdownPercent}%`,
            },
        });
    } catch (error) {
        // CAS 失败：可能是已触发或并发修改，需要 re-fetch 判定
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2025') {
                // Re-fetch 判定真实原因
                const currentBot = await prisma.bot.findUnique({
                    where: { id: botId },
                    select: { autoCloseTriggeredAt: true, statusVersion: true },
                });

                if (currentBot?.autoCloseTriggeredAt) {
                    // 已触发 = 幂等成功
                    return { triggered: false, previouslyTriggered: true };
                }

                // statusVersion 变化 = 并发修改
                throw createApiError(
                    'Bot state changed during risk check, please retry',
                    409,
                    'CONCURRENT_MODIFICATION'
                );
            }
        }
        throw error;
    }

    return {
        triggered: true,
        previouslyTriggered: false,
        newStatus: BotStatus.STOPPING,
        drawdownPercent: result.drawdownPercent,
    };
}

/**
 * 获取用于冻结的参考价格
 * 
 * 在 start/resume 时调用，用于返回应该写入 autoCloseReferencePrice 的值
 */
export async function getReferencePriceForFreeze(
    configJson: string,
    tickerLast: string
): Promise<string> {
    return getReferencePrice(configJson, tickerLast);
}
