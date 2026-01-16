/**
 * PreviewEngine - 纯函数，计算网格预览
 * 
 * 遵循规则：
 * - 无 I/O（禁止 prisma/createOrder）
 * - 全部数值用 decimal.js
 * - 输出规范化 decimal string
 * 
 * 来源：implementation_plan.md §2.4.2
 */

// decimal.js ESM 兼容导入
import { Decimal } from 'decimal.js';

// ============================================================================
// Types
// ============================================================================

export type ValidationSeverity = 'ERROR' | 'WARN';

export interface PreviewIssue {
    severity: ValidationSeverity;
    code: string;
    message: string;
}

export type PreviewLineKind = 'reference' | 'trigger' | 'bound' | 'risk';

export interface PreviewLine {
    kind: PreviewLineKind;
    label: string;
    price: string;
}

export interface PreviewOrder {
    side: 'buy' | 'sell';
    type: 'limit' | 'market';
    price?: string;
    quoteAmount: string;
    baseAmount?: string;
}

export interface PreviewEstimates {
    assumedFeeRate: string;
    spreadQuote: string;
    spreadPercent: string;
    estimatedFeeQuoteRoundTrip: string;
    estimatedNetProfitQuoteRoundTrip: string;
    notes: string[];
}

export interface PreviewResult {
    basePrice: string;
    buyTriggerPrice: string;
    sellTriggerPrice: string;
    lines: PreviewLine[];
    orders: PreviewOrder[];
    issues: PreviewIssue[];
    estimates?: PreviewEstimates;
}

// ============================================================================
// Input Types (带 Preview 前缀避免冲突)
// ============================================================================

export interface PreviewMarketInfo {
    symbol: string;
    pricePrecision: number;
    amountPrecision: number;
    minAmount: string;
    minNotional: string;
}

export interface PreviewTickerInfo {
    last: string;
    bid1?: string;
    ask1?: string;
}

export interface PreviewOrderBookLevel {
    price: string;
    amount: string;
}

export interface PreviewOrderBookInfo {
    bids: PreviewOrderBookLevel[];
    asks: PreviewOrderBookLevel[];
}

export interface PreviewBalanceInfo {
    quote: string;
    free: string;
}

export interface GridConfig {
    /**
     * Config schema version.
     * - v1 (default): percent fields are in "percent points" (e.g. "2" = 2%)
     * - v2+: percent fields are in ratio (e.g. "0.02" = 2%)
     */
    schemaVersion?: number;
    trigger: {
        gridType: 'percent' | 'price';
        basePriceType: 'current' | 'cost' | 'avg_24h' | 'manual';
        basePrice?: string;
        priceMin?: string;
        priceMax?: string;
        riseSell: string;
        fallBuy: string;
        enablePullbackSell?: boolean;
        pullbackSellPercent?: string;
        enableReboundBuy?: boolean;
        reboundBuyPercent?: string;
    };
    order: {
        orderType: 'limit' | 'market';
        /**
         * Entry execution price source (WAITING_TRIGGER only).
         * - trigger: use strategy trigger price
         * - orderbook: use order book level price (buy=askN, sell=bidN)
         */
        entryPriceSource?: 'trigger' | 'orderbook';
        /** 1-5, only when entryPriceSource=orderbook */
        entryBookLevel?: number;
    };
    sizing: {
        amountMode: 'percent' | 'amount';
        gridSymmetric: boolean;
        symmetric?: { orderQuantity: string };
        asymmetric?: { buyQuantity: string; sellQuantity: string };
    };
    position?: {
        maxPositionPercent?: string;
        minPositionPercent?: string;
    };
    lifecycle?: {
        /** -1 or undefined means no expiry */
        expiryDays?: number;
    };
    risk?: {
        enableBuy?: boolean;
        enableSell?: boolean;
        enableFloorPrice?: boolean;
        floorPrice?: string;
    };
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_FEE_RATE = '0.001';

// ============================================================================
// Helper: Decimal 规范化
// ============================================================================

const DEFAULT_DECIMALS = 8;
const MAX_DECIMALS = 18;

function clampInt(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    const n = Math.trunc(value);
    return Math.min(max, Math.max(min, n));
}

function precisionToDecimals(precision: number): number {
    if (!Number.isFinite(precision)) return DEFAULT_DECIMALS;

    // Most exchanges use decimal places (integer). Keep that fast path.
    if (Number.isInteger(precision)) {
        return clampInt(precision, 0, MAX_DECIMALS);
    }

    // Some feeds/providers return tick size (e.g. 0.01) instead of decimal places.
    // Decimal.js toFixed() requires an integer, so convert tick-size → decimal places.
    if (precision <= 0) return DEFAULT_DECIMALS;
    if (precision >= 1) return 0;

    const raw = String(precision).toLowerCase();
    const expIdx = raw.indexOf('e-');
    if (expIdx >= 0) {
        const exp = Number.parseInt(raw.slice(expIdx + 2), 10);
        const coeff = raw.slice(0, expIdx);
        const extra = coeff.includes('.') ? (coeff.split('.')[1]?.length ?? 0) : 0;
        if (Number.isFinite(exp) && exp > 0) {
            return clampInt(exp + extra, 0, MAX_DECIMALS);
        }
    }

    const dotIdx = raw.indexOf('.');
    if (dotIdx >= 0) {
        return clampInt(raw.length - dotIdx - 1, 0, MAX_DECIMALS);
    }

    return DEFAULT_DECIMALS;
}

function normalizeDecimal(value: Decimal, precision: number): string {
    return value.toFixed(precisionToDecimals(precision));
}

function parseDecimalSafe(value: string | undefined, fallback: string = '0'): Decimal {
    try {
        return new Decimal(value ?? fallback);
    } catch {
        return new Decimal(fallback);
    }
}

function getSchemaVersion(config: GridConfig): number {
    const raw = (config as GridConfig).schemaVersion;
    if (typeof raw !== 'number') return 1;
    if (!Number.isFinite(raw)) return 1;
    return Math.trunc(raw);
}

function percentToRatio(value: string | undefined, schemaVersion: number): Decimal {
    const raw = parseDecimalSafe(value);
    // v1 stores "percent points" (2 => 2%), so convert to ratio.
    // v2+ stores ratio directly (0.02 => 2%).
    return schemaVersion >= 2 ? raw : raw.div(100);
}

// ============================================================================
// PreviewEngine
// ============================================================================

export function calculatePreview(
    config: GridConfig,
    market: PreviewMarketInfo,
    ticker: PreviewTickerInfo,
    balance?: PreviewBalanceInfo,
    feeRate?: string
): PreviewResult {
    const issues: PreviewIssue[] = [];
    const lines: PreviewLine[] = [];
    const orders: PreviewOrder[] = [];
    const schemaVersion = getSchemaVersion(config);

    // 1. 校验 basePriceType
    if (config.trigger.basePriceType === 'cost') {
        issues.push({
            severity: 'ERROR',
            code: 'UNSUPPORTED_BASE_PRICE_TYPE',
            message: 'basePriceType=cost is not supported in V1, use manual or current',
        });
    }

    if (config.trigger.basePriceType === 'avg_24h') {
        issues.push({
            severity: 'ERROR',
            code: 'UNSUPPORTED_BASE_PRICE_TYPE',
            message: 'basePriceType=avg_24h is not supported in V1, use manual or current',
        });
    }

    // 2. 计算 basePrice
    let basePrice: Decimal;
    if (config.trigger.basePriceType === 'manual') {
        if (!config.trigger.basePrice) {
            issues.push({
                severity: 'ERROR',
                code: 'MISSING_BASE_PRICE',
                message: 'basePrice is required when basePriceType=manual',
            });
            basePrice = new Decimal(0);
        } else {
            basePrice = parseDecimalSafe(config.trigger.basePrice);
        }
    } else {
        basePrice = parseDecimalSafe(ticker.last);
    }

    // 3. 计算触发价
    let buyTriggerPrice: Decimal;
    let sellTriggerPrice: Decimal;

    if (config.trigger.gridType === 'percent') {
        const fallBuyRatio = percentToRatio(config.trigger.fallBuy, schemaVersion);
        const riseSellRatio = percentToRatio(config.trigger.riseSell, schemaVersion);

        buyTriggerPrice = basePrice.mul(new Decimal(1).minus(fallBuyRatio));
        sellTriggerPrice = basePrice.mul(new Decimal(1).plus(riseSellRatio));
    } else {
        const fallBuyAbs = parseDecimalSafe(config.trigger.fallBuy);
        const riseSellAbs = parseDecimalSafe(config.trigger.riseSell);

        buyTriggerPrice = basePrice.minus(fallBuyAbs);
        sellTriggerPrice = basePrice.plus(riseSellAbs);
    }

    // 规范化价格
    const basePriceNorm = normalizeDecimal(basePrice, market.pricePrecision);
    const buyTriggerNorm = normalizeDecimal(buyTriggerPrice, market.pricePrecision);
    const sellTriggerNorm = normalizeDecimal(sellTriggerPrice, market.pricePrecision);

    // 4. 添加 lines
    lines.push({ kind: 'reference', label: 'Base Price', price: basePriceNorm });
    lines.push({ kind: 'trigger', label: 'Buy Trigger', price: buyTriggerNorm });
    lines.push({ kind: 'trigger', label: 'Sell Trigger', price: sellTriggerNorm });

    if (config.trigger.priceMin) {
        lines.push({ kind: 'bound', label: 'Price Min', price: config.trigger.priceMin });
    }
    if (config.trigger.priceMax) {
        lines.push({ kind: 'bound', label: 'Price Max', price: config.trigger.priceMax });
    }
    if (config.risk?.enableFloorPrice && config.risk.floorPrice) {
        lines.push({ kind: 'risk', label: 'Floor Price', price: config.risk.floorPrice });
    }

    // 5. 计算订单金额
    let buyQuoteAmount: Decimal;
    let sellQuoteAmount: Decimal;

    if (config.sizing.amountMode === 'percent') {
        if (!balance) {
            issues.push({
                severity: 'WARN',
                code: 'BALANCE_UNAVAILABLE',
                message: 'Balance not available for percent calculation, using placeholder',
            });
            buyQuoteAmount = new Decimal(0);
            sellQuoteAmount = new Decimal(0);
        } else {
            const freeQuote = parseDecimalSafe(balance.free);

            if (config.sizing.gridSymmetric && config.sizing.symmetric) {
                const pct = parseDecimalSafe(config.sizing.symmetric.orderQuantity);
                buyQuoteAmount = freeQuote.mul(pct.div(100));
                sellQuoteAmount = buyQuoteAmount;
            } else if (config.sizing.asymmetric) {
                const buyPct = parseDecimalSafe(config.sizing.asymmetric.buyQuantity);
                const sellPct = parseDecimalSafe(config.sizing.asymmetric.sellQuantity);
                buyQuoteAmount = freeQuote.mul(buyPct.div(100));
                sellQuoteAmount = freeQuote.mul(sellPct.div(100));
            } else {
                issues.push({
                    severity: 'ERROR',
                    code: 'INVALID_SIZING_CONFIG',
                    message: 'Missing symmetric or asymmetric sizing config',
                });
                buyQuoteAmount = new Decimal(0);
                sellQuoteAmount = new Decimal(0);
            }
        }
    } else {
        if (config.sizing.gridSymmetric && config.sizing.symmetric) {
            buyQuoteAmount = parseDecimalSafe(config.sizing.symmetric.orderQuantity);
            sellQuoteAmount = buyQuoteAmount;
        } else if (config.sizing.asymmetric) {
            buyQuoteAmount = parseDecimalSafe(config.sizing.asymmetric.buyQuantity);
            sellQuoteAmount = parseDecimalSafe(config.sizing.asymmetric.sellQuantity);
        } else {
            issues.push({
                severity: 'ERROR',
                code: 'INVALID_SIZING_CONFIG',
                message: 'Missing symmetric or asymmetric sizing config',
            });
            buyQuoteAmount = new Decimal(0);
            sellQuoteAmount = new Decimal(0);
        }
    }

    // 6. 计算 baseAmount
    const buyBaseAmount = buyTriggerPrice.gt(0)
        ? buyQuoteAmount.div(buyTriggerPrice)
        : new Decimal(0);
    const sellBaseAmount = sellTriggerPrice.gt(0)
        ? sellQuoteAmount.div(sellTriggerPrice)
        : new Decimal(0);

    const buyQuoteNorm = normalizeDecimal(buyQuoteAmount, market.pricePrecision);
    const sellQuoteNorm = normalizeDecimal(sellQuoteAmount, market.pricePrecision);
    const buyBaseNorm = normalizeDecimal(buyBaseAmount, market.amountPrecision);
    const sellBaseNorm = normalizeDecimal(sellBaseAmount, market.amountPrecision);

    // 7. 校验 minAmount
    const minAmount = parseDecimalSafe(market.minAmount);

    if (buyBaseAmount.gt(0) && buyBaseAmount.lt(minAmount)) {
        issues.push({
            severity: 'ERROR',
            code: 'BELOW_MIN_AMOUNT',
            message: `Buy order amount ${buyBaseNorm} is below minimum ${market.minAmount}`,
        });
    }

    if (sellBaseAmount.gt(0) && sellBaseAmount.lt(minAmount)) {
        issues.push({
            severity: 'ERROR',
            code: 'BELOW_MIN_AMOUNT',
            message: `Sell order amount ${sellBaseNorm} is below minimum ${market.minAmount}`,
        });
    }

    // 8. 校验 minNotional
    const minNotional = parseDecimalSafe(market.minNotional);

    if (buyQuoteAmount.gt(0) && buyQuoteAmount.lt(minNotional)) {
        issues.push({
            severity: 'ERROR',
            code: 'BELOW_MIN_NOTIONAL',
            message: `Buy order notional ${buyQuoteNorm} is below minimum ${market.minNotional}`,
        });
    }

    if (sellQuoteAmount.gt(0) && sellQuoteAmount.lt(minNotional)) {
        issues.push({
            severity: 'ERROR',
            code: 'BELOW_MIN_NOTIONAL',
            message: `Sell order notional ${sellQuoteNorm} is below minimum ${market.minNotional}`,
        });
    }

    // 9. 添加 orders
    if (config.order.orderType === 'limit') {
        if (buyQuoteAmount.gt(0)) {
            orders.push({
                side: 'buy',
                type: 'limit',
                price: buyTriggerNorm,
                quoteAmount: buyQuoteNorm,
                baseAmount: buyBaseNorm,
            });
        }
        if (sellQuoteAmount.gt(0)) {
            orders.push({
                side: 'sell',
                type: 'limit',
                price: sellTriggerNorm,
                quoteAmount: sellQuoteNorm,
                baseAmount: sellBaseNorm,
            });
        }
    } else {
        if (buyQuoteAmount.gt(0)) {
            orders.push({
                side: 'buy',
                type: 'market',
                quoteAmount: buyQuoteNorm,
                baseAmount: buyBaseNorm,
            });
        }
        if (sellQuoteAmount.gt(0)) {
            orders.push({
                side: 'sell',
                type: 'market',
                quoteAmount: sellQuoteNorm,
                baseAmount: sellBaseNorm,
            });
        }
    }

    // 10. 计算 estimates
    let estimates: PreviewEstimates | undefined;

    const hasErrors = issues.some(i => i.severity === 'ERROR');
    if (!hasErrors && buyQuoteAmount.gt(0) && sellQuoteAmount.gt(0)) {
        const effectiveFeeRate = parseDecimalSafe(feeRate ?? DEFAULT_FEE_RATE);
        const spread = sellTriggerPrice.minus(buyTriggerPrice);
        const spreadPercent = basePrice.gt(0) ? spread.div(basePrice) : new Decimal(0);

        const totalNotional = buyQuoteAmount.plus(sellQuoteAmount);
        const feeRoundTrip = totalNotional.mul(effectiveFeeRate);

        const avgBaseAmount = buyBaseAmount.plus(sellBaseAmount).div(2);
        const grossProfit = avgBaseAmount.mul(spread);
        const netProfit = grossProfit.minus(feeRoundTrip);

        estimates = {
            assumedFeeRate: effectiveFeeRate.toString(),
            spreadQuote: normalizeDecimal(spread, market.pricePrecision),
            spreadPercent: spreadPercent.toFixed(4),
            estimatedFeeQuoteRoundTrip: normalizeDecimal(feeRoundTrip, market.pricePrecision),
            estimatedNetProfitQuoteRoundTrip: normalizeDecimal(netProfit, market.pricePrecision),
            notes: [
                '假设按触发价立即成交',
                '忽略滑点与撮合延迟',
                '忽略部分成交情况',
            ],
        };
    }

    return {
        basePrice: basePriceNorm,
        buyTriggerPrice: buyTriggerNorm,
        sellTriggerPrice: sellTriggerNorm,
        lines,
        orders,
        issues,
        estimates,
    };
}

/**
 * 检查 Preview 结果是否有阻断性错误
 */
export function hasBlockingErrors(result: PreviewResult): boolean {
    return result.issues.some(i => i.severity === 'ERROR');
}
