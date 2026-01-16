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
import type {
    Balance,
    GridConfig,
    PreviewBalanceInfo,
    PreviewMarketInfo,
    PreviewOrderBookInfo,
    PreviewOrder,
    PreviewResult,
    TradingExecutor,
} from '@crypto-strategy-hub/shared';
import {
    calculatePreview,
    checkPriceBounds,
    generateClientOrderId,
    riskGate,
} from '@crypto-strategy-hub/shared';
import { Decimal } from 'decimal.js';
import { classifyRetryableError, computeBackoffMs } from './retry.js';
import { alertCritical, alertWarning } from './metrics.js';

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

type TriggerConfirmState =
    | { side: 'buy'; troughPrice: string; updatedAtMs: number }
    | { side: 'sell'; peakPrice: string; updatedAtMs: number };

const triggerConfirmState = new Map<string, TriggerConfirmState>(); // key: Bot.id

function parseDecimalSafe(value: string | undefined, fallback: string = '0'): Decimal {
    try {
        return new Decimal(value ?? fallback);
    } catch {
        return new Decimal(fallback);
    }
}

function getSchemaVersion(config: GridConfig): number {
    const raw = config.schemaVersion;
    if (typeof raw !== 'number') return 1;
    if (!Number.isFinite(raw)) return 1;
    return Math.trunc(raw);
}

function percentToRatio(value: string | undefined, schemaVersion: number): Decimal {
    const raw = parseDecimalSafe(value);
    return schemaVersion >= 2 ? raw : raw.div(100);
}

function normalizeBookLevel(raw: unknown, fallback: number = 1): number {
    if (typeof raw !== 'number') return fallback;
    if (!Number.isFinite(raw)) return fallback;
    const n = Math.trunc(raw);
    return Math.max(1, Math.min(5, n));
}

function getOrderBookPrice(
    orderBook: PreviewOrderBookInfo | undefined,
    side: 'buy' | 'sell',
    level: number
): string | null {
    if (!orderBook) return null;
    const idx = Math.max(1, Math.min(5, level)) - 1;
    const levels = side === 'buy' ? orderBook.asks : orderBook.bids;
    const price = levels[idx]?.price;
    if (typeof price !== 'string' || price.length === 0) return null;
    return price;
}

function parseSymbolPair(symbol: string): { base: string; quote: string } | null {
    const parts = symbol.split('/');
    if (parts.length !== 2) return null;
    const base = parts[0]?.trim();
    const quote = parts[1]?.trim();
    if (!base || !quote) return null;
    return { base, quote };
}

function getPreviewOrder(preview: PreviewResult, side: 'buy' | 'sell'): PreviewOrder | null {
    const order = preview.orders.find((o) => o.side === side);
    return order ?? null;
}

function computeBaseAmountFromQuote(
    quoteAmount: string,
    price: string,
    amountPrecision: number
): string | null {
    let quote: Decimal;
    let p: Decimal;
    try {
        quote = new Decimal(quoteAmount);
        p = new Decimal(price);
    } catch {
        return null;
    }
    if (p.lte(0)) return null;
    return quote.div(p).toFixed(amountPrecision);
}

function normalizePositionPercent(configValue: string, schemaVersion: number): Decimal {
    const raw = parseDecimalSafe(configValue);
    // v1: 0-100 (percent points), v2+: 0-1 ratio
    return schemaVersion >= 2 ? raw.mul(100) : raw;
}

function computeCurrentPositionPercent(
    balances: Record<string, Balance>,
    symbol: { base: string; quote: string },
    tickerLast: string
): Decimal | undefined {
    const baseTotal = parseDecimalSafe(balances[symbol.base]?.total);
    const quoteTotal = parseDecimalSafe(balances[symbol.quote]?.total);
    const last = parseDecimalSafe(tickerLast);

    if (last.lte(0)) return undefined;

    const baseValue = baseTotal.mul(last);
    const totalValue = baseValue.plus(quoteTotal);
    if (totalValue.lte(0)) return undefined;

    return baseValue.div(totalValue).mul(100);
}

function isSideBlockedByConfig(
    config: GridConfig,
    schemaVersion: number,
    side: 'buy' | 'sell',
    currentPrice: string,
    currentPositionPercent?: Decimal
): { blocked: boolean; code?: string; reason?: string } {
    // RiskGate (buy/sell enable switches)
    const risk = riskGate(
        { enableBuy: config.risk?.enableBuy, enableSell: config.risk?.enableSell },
        { side }
    );
    if (risk.blocked) {
        return { blocked: true, code: risk.code, reason: risk.reason };
    }

    // Position bounds (V1 minimal): max blocks buy, min blocks sell
    if (currentPositionPercent) {
        if (side === 'buy' && config.position?.maxPositionPercent) {
            const max = normalizePositionPercent(config.position.maxPositionPercent, schemaVersion);
            if (currentPositionPercent.gte(max)) {
                return {
                    blocked: true,
                    code: 'POSITION_ABOVE_MAX',
                    reason: `Position ${currentPositionPercent.toFixed(2)}% is above maximum ${max.toFixed(2)}%`,
                };
            }
        }

        if (side === 'sell' && config.position?.minPositionPercent) {
            const min = normalizePositionPercent(config.position.minPositionPercent, schemaVersion);
            if (currentPositionPercent.lte(min)) {
                return {
                    blocked: true,
                    code: 'POSITION_BELOW_MIN',
                    reason: `Position ${currentPositionPercent.toFixed(2)}% is below minimum ${min.toFixed(2)}%`,
                };
            }
        }
    }

    return { blocked: false };
}

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
    orderBook?: PreviewOrderBookInfo;
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

        // 发送告警：重试耗尽
        void alertCritical(
            '订单提交失败',
            `订单 ${order.clientOrderId} 提交失败，已达最大重试次数: ${info.message}`,
            { botId: order.botId, symbol: order.symbol }
        );
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

    const schemaVersion = getSchemaVersion(rawConfig);

    // 仅支持 limit（V1 最小闭环）
    let config: GridConfig;
    try {
        config = normalizeExecutionConfig(bot, rawConfig);
    } catch {
        return;
    }

    // 使用传入的 marketInfo（实盘），或 fallback 到硬编码（测试）
    const market = input.marketInfo || buildMarketInfo(bot.symbol, pricePrecision, amountPrecision);
    const ticker = { last: input.tickerPrice };

    const symbolPair = parseSymbolPair(bot.symbol);
    const needsBalances =
        config.sizing.amountMode === 'percent' ||
        !!config.position?.maxPositionPercent ||
        !!config.position?.minPositionPercent;

    let balances: Record<string, Balance> | null = null;
    let previewBalance: PreviewBalanceInfo | undefined;
    let currentPositionPercent: Decimal | undefined;

    if (needsBalances) {
        if (!symbolPair) {
            console.warn(`[TriggerOrder] Bot ${botId}: invalid symbol format ${bot.symbol}`);
            return;
        }

        try {
            balances = await input.executor.fetchBalance();
        } catch (error) {
            console.error(`[TriggerOrder] Bot ${botId}: failed to fetch balance:`, error);
            return;
        }

        if (config.sizing.amountMode === 'percent') {
            const freeQuote = balances[symbolPair.quote]?.free ?? '0';
            if (parseDecimalSafe(freeQuote).lte(0)) {
                return;
            }
            previewBalance = { quote: symbolPair.quote, free: freeQuote };
        }

        if (config.position?.maxPositionPercent || config.position?.minPositionPercent) {
            currentPositionPercent = computeCurrentPositionPercent(balances, symbolPair, ticker.last);
        }
    }

    // BoundsGate（ACC-GATE-001）：价格越界时不触发、不下单（不进入 ERROR）
    try {
        const gate = checkPriceBounds({ priceMin: config.trigger.priceMin }, { currentPrice: ticker.last });
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
            // 网格的“下一腿”固定使用 limit 挂单；market 仅用于入场（WAITING_TRIGGER）。
            // 否则会出现：config.order.orderType=market 时 Preview 没有 limit order，导致下一腿无法计算 baseAmount。
            order: { ...config.order, orderType: 'limit' },
            trigger: {
                ...config.trigger,
                basePriceType: 'manual',
                basePrice: refPrice,
            },
        };

        const legPreview = calculatePreview(legConfig, market, ticker, previewBalance);

        const nextSide: 'buy' | 'sell' = lastFilled.side === 'buy' ? 'sell' : 'buy';
        const nextPrice = nextSide === 'sell' ? legPreview.sellTriggerPrice : legPreview.buyTriggerPrice;
        const nextBaseAmount = getLimitBaseAmount(legPreview, nextSide);

        const blocked = isSideBlockedByConfig(config, schemaVersion, nextSide, ticker.last, currentPositionPercent);
        if (blocked.blocked) {
            return;
        }

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

    const preview = calculatePreview(config, market, ticker, previewBalance);

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

    const entryOrderType: 'limit' | 'market' = config.order.orderType === 'market' ? 'market' : 'limit';
    const entryPriceSource: 'trigger' | 'orderbook' =
        config.order.entryPriceSource === 'orderbook' ? 'orderbook' : 'trigger';
    const entryBookLevel = normalizeBookLevel(config.order.entryBookLevel, 1);
    const resolveEntryExecutionPrice = (s: 'buy' | 'sell', fallback: string): string => {
        if (entryPriceSource !== 'orderbook') return fallback;
        return getOrderBookPrice(input.orderBook, s, entryBookLevel) ?? fallback;
    };

    let side: 'buy' | 'sell' | null = null;
    let limitPrice: string | null = null;
    let baseAmount: string | null = null;
    let priceForChecks: string | null = null;

    const enablePullbackSell = !!config.trigger.enablePullbackSell && !!config.trigger.pullbackSellPercent;
    const enableReboundBuy = !!config.trigger.enableReboundBuy && !!config.trigger.reboundBuyPercent;
    const pullbackRatio = enablePullbackSell ? percentToRatio(config.trigger.pullbackSellPercent, schemaVersion) : new Decimal(0);
    const reboundRatio = enableReboundBuy ? percentToRatio(config.trigger.reboundBuyPercent, schemaVersion) : new Decimal(0);

    const nowMs = Date.now();
    const existingState = triggerConfirmState.get(botId);
    if (existingState && nowMs - existingState.updatedAtMs > 24 * 60 * 60 * 1000) {
        triggerConfirmState.delete(botId);
    }

    const state = triggerConfirmState.get(botId);

    if (state?.side === 'buy') {
        if (!enableReboundBuy || reboundRatio.lte(0)) {
            triggerConfirmState.delete(botId);
        } else {
            const trough = new Decimal(state.troughPrice);
            const nextTrough = last.lt(trough) ? last : trough;
            const threshold = nextTrough.mul(new Decimal(1).plus(reboundRatio));

            if (last.gte(threshold)) {
                const order = getPreviewOrder(preview, 'buy');
                if (!order) return;

                side = 'buy';
                const execPrice = resolveEntryExecutionPrice('buy', ticker.last);
                priceForChecks = execPrice;
                if (entryOrderType === 'limit') {
                    limitPrice = execPrice;
                }
                baseAmount = computeBaseAmountFromQuote(order.quoteAmount, execPrice, amountPrecision);
                triggerConfirmState.delete(botId);
            } else {
                triggerConfirmState.set(botId, {
                    side: 'buy',
                    troughPrice: nextTrough.toString(),
                    updatedAtMs: nowMs,
                });
                return;
            }
        }
    } else if (state?.side === 'sell') {
        if (!enablePullbackSell || pullbackRatio.lte(0)) {
            triggerConfirmState.delete(botId);
        } else {
            const peak = new Decimal(state.peakPrice);
            const nextPeak = last.gt(peak) ? last : peak;
            const threshold = nextPeak.mul(new Decimal(1).minus(pullbackRatio));

            if (last.lte(threshold)) {
                const order = getPreviewOrder(preview, 'sell');
                if (!order) return;

                side = 'sell';
                const execPrice = resolveEntryExecutionPrice('sell', ticker.last);
                priceForChecks = execPrice;
                if (entryOrderType === 'limit') {
                    limitPrice = execPrice;
                }
                baseAmount = computeBaseAmountFromQuote(order.quoteAmount, execPrice, amountPrecision);
                triggerConfirmState.delete(botId);
            } else {
                triggerConfirmState.set(botId, {
                    side: 'sell',
                    peakPrice: nextPeak.toString(),
                    updatedAtMs: nowMs,
                });
                return;
            }
        }
    }

    if (!side) {
        if (last.lte(buyTrigger)) {
            if (enableReboundBuy && reboundRatio.gt(0)) {
                triggerConfirmState.set(botId, {
                    side: 'buy',
                    troughPrice: last.toString(),
                    updatedAtMs: nowMs,
                });
                return;
            }

            side = 'buy';
            const order = getPreviewOrder(preview, 'buy');
            if (!order) return;

            if (entryOrderType === 'limit' && entryPriceSource === 'trigger') {
                limitPrice = preview.buyTriggerPrice;
                priceForChecks = limitPrice;
                baseAmount = getLimitBaseAmount(preview, 'buy');
            } else {
                const execPrice = resolveEntryExecutionPrice('buy', ticker.last);
                priceForChecks = execPrice;
                if (entryOrderType === 'limit') {
                    limitPrice = execPrice;
                }
                baseAmount = computeBaseAmountFromQuote(order.quoteAmount, execPrice, amountPrecision);
            }
        } else if (last.gte(sellTrigger)) {
            if (enablePullbackSell && pullbackRatio.gt(0)) {
                triggerConfirmState.set(botId, {
                    side: 'sell',
                    peakPrice: last.toString(),
                    updatedAtMs: nowMs,
                });
                return;
            }

            side = 'sell';
            const order = getPreviewOrder(preview, 'sell');
            if (!order) return;

            if (entryOrderType === 'limit' && entryPriceSource === 'trigger') {
                limitPrice = preview.sellTriggerPrice;
                priceForChecks = limitPrice;
                baseAmount = getLimitBaseAmount(preview, 'sell');
            } else {
                const execPrice = resolveEntryExecutionPrice('sell', ticker.last);
                priceForChecks = execPrice;
                if (entryOrderType === 'limit') {
                    limitPrice = execPrice;
                }
                baseAmount = computeBaseAmountFromQuote(order.quoteAmount, execPrice, amountPrecision);
            }
        } else {
            return;
        }
    }

    if (!baseAmount || !priceForChecks) {
        return;
    }
    if (entryOrderType === 'limit' && !limitPrice) {
        return;
    }

    const blocked = isSideBlockedByConfig(config, schemaVersion, side, ticker.last, currentPositionPercent);
    if (blocked.blocked) {
        triggerConfirmState.delete(botId);
        return;
    }

    // 6) 硬阻断：检查 minAmount 和 minNotional
    // 如果不满足，交易所会拒单，必须标记 bot ERROR 防止 outbox 无限重试
    const amountDec = new Decimal(baseAmount);
    const priceDec = new Decimal(priceForChecks);
    const notional = amountDec.mul(priceDec);
    const minAmountDec = new Decimal(market.minAmount || '0');
    const minNotionalDec = new Decimal(market.minNotional || '0');

    if (amountDec.lt(minAmountDec)) {
        await markBotError(botId, `BELOW_MIN_AMOUNT: order amount ${baseAmount} < minAmount ${market.minAmount}`);
        console.error(`[TriggerOrder] Bot ${botId}: BELOW_MIN_AMOUNT (${baseAmount} < ${market.minAmount})`);
        return;
    }

    if (notional.lt(minNotionalDec)) {
        await markBotError(
            botId,
            `BELOW_MIN_NOTIONAL: notional ${notional.toFixed(8)} < minNotional ${market.minNotional}`
        );
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
                type: entryOrderType,
                status: 'NEW',
                price: entryOrderType === 'limit' ? limitPrice! : null,
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
