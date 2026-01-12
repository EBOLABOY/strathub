/**
 * Trigger/Order Loop (V1)
 *
 * 目标：
 * - 单层触发式网格：触发后只下 1 单（buy 或 sell）
 * - DB 先落库意图（Order.submittedAt=null）→ 再执行 I/O（createOrder）
 * - 幂等：同一个 intentSeq 只会提交一次；重启后不会重复 createOrder
 *
 * 当前实现最小化：
 * - 只处理 RUNNING / WAITING_TRIGGER
 * - 只支持 limit 单
 * - 金额口径复用 PreviewEngine（quoteAmount → baseAmount）
 */

import { prisma, Prisma } from '@crypto-strategy-hub/database';
import type { GridConfig, PreviewMarketInfo, PreviewResult, TradingExecutor } from '@crypto-strategy-hub/shared';
import { calculatePreview, checkPriceBounds, generateClientOrderId } from '@crypto-strategy-hub/shared';
import { Decimal } from 'decimal.js';
import { classifyRetryableError, computeBackoffMs } from './retry.js';

// ============================================================================
// Retry Policy (V1)
// ============================================================================

const SUBMIT_MAX_RETRIES = parseInt(process.env['WORKER_ORDER_MAX_RETRIES'] ?? '5', 10);
const SUBMIT_BACKOFF = {
    baseMs: parseInt(process.env['WORKER_ORDER_BACKOFF_BASE_MS'] ?? '1000', 10),
    maxMs: parseInt(process.env['WORKER_ORDER_BACKOFF_MAX_MS'] ?? '30000', 10),
    jitterRatio: 0.2,
} as const;

type SubmitRetryState = { attempts: number; nextAtMs: number };
const submitRetryState = new Map<string, SubmitRetryState>(); // key: Order.id

async function markBotError(botId: string, reason: string): Promise<void> {
    const current = await prisma.bot.findUnique({
        where: { id: botId },
        select: { status: true, statusVersion: true },
    });
    if (!current || current.status === 'ERROR') {
        return;
    }

    try {
        await prisma.bot.update({
            where: { id: botId, statusVersion: current.statusVersion },
            data: {
                status: 'ERROR',
                statusVersion: current.statusVersion + 1,
                lastError: reason,
            },
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            return;
        }
        throw error;
    }
}

export interface ProcessTriggerOrderInput {
    executor: TradingExecutor;
    tickerPrice: string;
    pricePrecision?: number;
    amountPrecision?: number;
    marketInfo?: PreviewMarketInfo;
}

function buildMarketInfo(
    symbol: string,
    pricePrecision: number,
    amountPrecision: number
): PreviewMarketInfo {
    return {
        symbol,
        pricePrecision,
        amountPrecision,
        minAmount: '0',
        minNotional: '0',
    };
}

function getLimitBaseAmount(preview: PreviewResult, side: 'buy' | 'sell'): string {
    const order = preview.orders.find((o) => o.type === 'limit' && o.side === side);
    if (!order?.baseAmount) {
        throw new Error(`Missing baseAmount for ${side} limit order`);
    }
    return order.baseAmount;
}

function normalizeExecutionConfig(bot: { autoCloseReferencePrice: string | null }, raw: GridConfig): GridConfig {
    const trigger = raw.trigger;

    // V1：cost/avg_24h 仍然不支持（Preview/Start 已阻断，但这里再防一层）
    if (trigger.basePriceType === 'cost' || trigger.basePriceType === 'avg_24h') {
        throw new Error('UNSUPPORTED_BASE_PRICE_TYPE');
    }

    // 执行阶段必须使用“冻结”的基准价，避免 basePriceType=current 导致触发永远不成立
    if (trigger.basePriceType === 'current') {
        if (!bot.autoCloseReferencePrice) {
            throw new Error('MISSING_FROZEN_REFERENCE_PRICE');
        }
        return {
            ...raw,
            trigger: {
                ...trigger,
                basePriceType: 'manual',
                basePrice: bot.autoCloseReferencePrice,
            },
        };
    }

    // manual：原样
    return raw;
}

async function submitOrderIntent(
    executor: TradingExecutor,
    order: {
        id: string;
        botId: string;
        exchange: string;
        symbol: string;
        clientOrderId: string;
        exchangeOrderId: string | null;
        side: string;
        type: string;
        price: string | null;
        amount: string;
        submittedAt: Date | null;
    },
    botStatus: string
): Promise<void> {
    // STOPPING/PAUSED/STOPPED 不允许提交 outbox
    if (['STOPPING', 'PAUSED', 'STOPPED', 'ERROR'].includes(botStatus)) {
        return;
    }

    // 如果已有 exchangeOrderId，则认为已提交（reconcile 导入的订单也会带 exchangeOrderId）
    if (order.submittedAt || order.exchangeOrderId) {
        submitRetryState.delete(order.id);
        return;
    }

    const nowMs = Date.now();
    const state = submitRetryState.get(order.id);
    if (state && nowMs < state.nextAtMs) {
        return;
    }

    const side = order.side === 'sell' ? 'sell' : 'buy';
    const type = order.type === 'market' ? 'market' : 'limit';

    if (type === 'limit' && !order.price) {
        throw new Error('MISSING_LIMIT_PRICE');
    }

    const now = new Date();

    try {
        const placed = await executor.createOrder({
            symbol: order.symbol,
            side,
            type,
            price: order.price ?? undefined,
            amount: order.amount,
            clientOrderId: order.clientOrderId,
        });

        submitRetryState.delete(order.id);

        await prisma.order.update({
            where: {
                exchange_clientOrderId: {
                    exchange: order.exchange,
                    clientOrderId: order.clientOrderId,
                },
            },
            data: {
                exchangeOrderId: placed.exchangeOrderId,
                status: placed.status,
                submittedAt: now,
            },
        });
    } catch (error) {
        const info = classifyRetryableError(error);
        const nextAttempt = (state?.attempts ?? 0) + 1;

        if (info.retryable && nextAttempt < SUBMIT_MAX_RETRIES) {
            const backoffMs = computeBackoffMs(nextAttempt, SUBMIT_BACKOFF, info.retryAfterMs);
            submitRetryState.set(order.id, { attempts: nextAttempt, nextAtMs: nowMs + backoffMs });
            return;
        }

        submitRetryState.delete(order.id);
        await markBotError(order.botId, `ORDER_SUBMIT_FAILED: ${info.code ?? 'UNKNOWN'}: ${info.message}`);
    }
}

/**
 * 处理单个 bot 的 trigger → order intent → submit 流程
 */
export async function processTriggerOrder(
    botId: string,
    input: ProcessTriggerOrderInput
): Promise<void> {
    const pricePrecision = input.pricePrecision ?? 2;
    const amountPrecision = input.amountPrecision ?? 8;

    const bot = await prisma.bot.findUnique({
        where: { id: botId },
        include: { exchangeAccount: true },
    });

    if (!bot) {
        return;
    }

    if (bot.status !== 'WAITING_TRIGGER' && bot.status !== 'RUNNING') {
        return;
    }

    // 0) 先处理未提交的意图（outbox）
    const pending = await prisma.order.findFirst({
        where: { botId, submittedAt: null, exchangeOrderId: null },
        orderBy: [{ intentSeq: 'desc' }, { createdAt: 'desc' }],
    });
    if (pending) {
        await submitOrderIntent(input.executor, pending, bot.status);
        return;
    }

    // 1) 如有 open order，等待成交（单 bot 同时最多 1 张 open order）
    const openOrder = await prisma.order.findFirst({
        where: {
            botId,
            exchangeOrderId: { not: null },
            status: { in: ['NEW', 'PARTIALLY_FILLED'] },
        },
        orderBy: [{ intentSeq: 'desc' }, { createdAt: 'desc' }],
    });
    if (openOrder) {
        return;
    }

    // 2) 解析配置并构建 Preview 依赖（复用口径）
    let rawConfig: GridConfig;
    try {
        rawConfig = JSON.parse(bot.configJson) as GridConfig;
    } catch {
        return;
    }

    // 仅支持 limit（V1 最小闭环）
    if (rawConfig.order?.orderType !== 'limit') {
        return;
    }

    let config: GridConfig;
    try {
        config = normalizeExecutionConfig(bot, rawConfig);
    } catch {
        return;
    }

    // 使用传入的 marketInfo（实盘），或 fallback 到硬编码（测试）
    const market = input.marketInfo || buildMarketInfo(bot.symbol, pricePrecision, amountPrecision);
    const ticker = { last: input.tickerPrice };

    // BoundsGate（ACC-GATE-001）：价格越界时不触发、不下单（不进入 ERROR）
    try {
        const gate = checkPriceBounds(
            { priceMin: config.trigger.priceMin, priceMax: config.trigger.priceMax },
            { currentPrice: ticker.last }
        );
        if (gate.blocked) {
            return;
        }
    } catch {
        return;
    }

    // 3) 若存在上一腿 FILLED，则生成下一腿（不再依赖当前 ticker 触发）
    const lastFilled = await prisma.order.findFirst({
        where: { botId, status: 'FILLED' },
        orderBy: [{ intentSeq: 'desc' }, { createdAt: 'desc' }],
    });

    if (lastFilled) {
        const refPrice = lastFilled.avgFillPrice ?? lastFilled.price;
        if (!refPrice) {
            return;
        }

        // 用“上一腿成交均价”作为下一腿定价基准
        const legConfig: GridConfig = {
            ...config,
            trigger: {
                ...config.trigger,
                basePriceType: 'manual',
                basePrice: refPrice,
            },
        };

        const legPreview = calculatePreview(legConfig, market, ticker);

        const nextSide: 'buy' | 'sell' = lastFilled.side === 'buy' ? 'sell' : 'buy';
        const nextPrice = nextSide === 'sell' ? legPreview.sellTriggerPrice : legPreview.buyTriggerPrice;
        const nextBaseAmount = getLimitBaseAmount(legPreview, nextSide);

        // next intentSeq = max(intentSeq)+1
        const lastIntent = await prisma.order.findFirst({
            where: { botId },
            select: { intentSeq: true },
            orderBy: [{ intentSeq: 'desc' }, { createdAt: 'desc' }],
        });
        const nextIntentSeq = (lastIntent?.intentSeq ?? 0) + 1;
        const clientOrderId = generateClientOrderId(bot.id, nextIntentSeq);

        const created = await prisma.order.create({
            data: {
                botId: bot.id,
                exchange: bot.exchangeAccount.exchange,
                symbol: bot.symbol,
                clientOrderId,
                exchangeOrderId: null,
                submittedAt: null,
                side: nextSide,
                type: 'limit',
                status: 'NEW',
                price: nextPrice,
                amount: nextBaseAmount,
                filledAmount: '0',
                avgFillPrice: null,
                intentSeq: nextIntentSeq,
            },
        });

        await submitOrderIntent(input.executor, created, bot.status);
        return;
    }

    // 4) 没有上一腿：仅在 WAITING_TRIGGER 执行触发判定
    if (bot.status !== 'WAITING_TRIGGER') {
        return;
    }

    const preview = calculatePreview(config, market, ticker);

    // 使用 Decimal 进行触发判断（避免浮点误差）
    let last: Decimal;
    let buyTrigger: Decimal;
    let sellTrigger: Decimal;

    try {
        last = new Decimal(input.tickerPrice);
        buyTrigger = new Decimal(preview.buyTriggerPrice);
        sellTrigger = new Decimal(preview.sellTriggerPrice);
    } catch {
        // 非法输入直接返回
        return;
    }

    let side: 'buy' | 'sell' | null = null;
    let limitPrice: string | null = null;
    let baseAmount: string | null = null;

    if (last.lte(buyTrigger)) {
        side = 'buy';
        limitPrice = preview.buyTriggerPrice;
        baseAmount = getLimitBaseAmount(preview, 'buy');
    } else if (last.gte(sellTrigger)) {
        side = 'sell';
        limitPrice = preview.sellTriggerPrice;
        baseAmount = getLimitBaseAmount(preview, 'sell');
    } else {
        return;
    }

    // 6) 硬阻断：检查 minAmount 和 minNotional
    // 如果不满足，交易所会拒单，必须标记 bot ERROR 防止 outbox 无限重试
    const amountDec = new Decimal(baseAmount);
    const priceDec = new Decimal(limitPrice);
    const notional = amountDec.mul(priceDec);
    const minAmountDec = new Decimal(market.minAmount || '0');
    const minNotionalDec = new Decimal(market.minNotional || '0');

    if (amountDec.lt(minAmountDec)) {
        await prisma.bot.update({
            where: { id: botId },
            data: {
                status: 'ERROR',
                lastError: `BELOW_MIN_AMOUNT: order amount ${baseAmount} < minAmount ${market.minAmount}`,
            },
        });
        console.error(`[TriggerOrder] Bot ${botId}: BELOW_MIN_AMOUNT (${baseAmount} < ${market.minAmount})`);
        return;
    }

    if (notional.lt(minNotionalDec)) {
        await prisma.bot.update({
            where: { id: botId },
            data: {
                status: 'ERROR',
                lastError: `BELOW_MIN_NOTIONAL: notional ${notional.toFixed(8)} < minNotional ${market.minNotional}`,
            },
        });
        console.error(`[TriggerOrder] Bot ${botId}: BELOW_MIN_NOTIONAL (${notional.toFixed(8)} < ${market.minNotional})`);
        return;
    }

    // 7) 在事务中：创建意图 + WAITING_TRIGGER → RUNNING bump（无 I/O）
    const result = await prisma.$transaction(async (tx) => {
        const currentBot = await tx.bot.findUnique({
            where: { id: botId },
            select: { status: true, statusVersion: true },
        });

        if (!currentBot || currentBot.status !== 'WAITING_TRIGGER') {
            return null;
        }

        // double-check：如果此时已经有订单（并发/重复 tick），直接幂等返回
        const existing = await tx.order.findFirst({
            where: { botId },
            select: { id: true },
        });
        if (existing) {
            return null;
        }

        const nextIntent = await tx.order.findFirst({
            where: { botId },
            select: { intentSeq: true },
            orderBy: [{ intentSeq: 'desc' }, { createdAt: 'desc' }],
        });
        const nextIntentSeq = (nextIntent?.intentSeq ?? 0) + 1;
        const clientOrderId = generateClientOrderId(bot.id, nextIntentSeq);

        const order = await tx.order.create({
            data: {
                botId: bot.id,
                exchange: bot.exchangeAccount.exchange,
                symbol: bot.symbol,
                clientOrderId,
                exchangeOrderId: null,
                submittedAt: null,
                side: side!,
                type: 'limit',
                status: 'NEW',
                price: limitPrice!,
                amount: baseAmount!,
                filledAmount: '0',
                avgFillPrice: null,
                intentSeq: nextIntentSeq,
            },
        });

        await tx.bot.update({
            where: { id: botId, statusVersion: currentBot.statusVersion },
            data: {
                status: 'RUNNING',
                statusVersion: currentBot.statusVersion + 1,
            },
        });

        return order;
    });

    if (!result) {
        return;
    }

    try {
        await submitOrderIntent(input.executor, result, 'RUNNING');
    } catch (error) {
        // 提交失败：保留 submittedAt=null，等待下次 tick 重试
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            throw error;
        }
        return;
    }
}
