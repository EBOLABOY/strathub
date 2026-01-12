/**
 * BoundsGate - 价格/仓位范围检查
 * 
 * 来源：docs/spec/conditions.md §5 Gate
 * 
 * 职责：
 * - 检查价格是否在 [priceMin, priceMax] 范围内
 * - 检查仓位是否在 [minPositionPercent, maxPositionPercent] 范围内
 */

import { Decimal } from 'decimal.js';

export interface BoundsGateConfig {
    priceMin?: string;
    priceMax?: string;
    maxPositionPercent?: string;
    minPositionPercent?: string;
}

export interface BoundsGateContext {
    currentPrice: string;
    currentPositionPercent?: string;
}

export type GateResult =
    | { blocked: false }
    | { blocked: true; reason: string; code: string };

/**
 * 检查价格边界
 */
export function checkPriceBounds(
    config: BoundsGateConfig,
    ctx: BoundsGateContext
): GateResult {
    const price = new Decimal(ctx.currentPrice);

    // 检查最低价
    if (config.priceMin) {
        const min = new Decimal(config.priceMin);
        if (price.lt(min)) {
            return {
                blocked: true,
                reason: `Price ${ctx.currentPrice} is below minimum ${config.priceMin}`,
                code: 'PRICE_BELOW_MIN',
            };
        }
    }

    // 检查最高价
    if (config.priceMax) {
        const max = new Decimal(config.priceMax);
        if (price.gt(max)) {
            return {
                blocked: true,
                reason: `Price ${ctx.currentPrice} is above maximum ${config.priceMax}`,
                code: 'PRICE_ABOVE_MAX',
            };
        }
    }

    return { blocked: false };
}

/**
 * 检查仓位边界
 */
export function checkPositionBounds(
    config: BoundsGateConfig,
    ctx: BoundsGateContext
): GateResult {
    if (!ctx.currentPositionPercent) {
        return { blocked: false };
    }

    const position = new Decimal(ctx.currentPositionPercent);

    // 检查最低仓位
    if (config.minPositionPercent) {
        const min = new Decimal(config.minPositionPercent);
        if (position.lt(min)) {
            return {
                blocked: true,
                reason: `Position ${ctx.currentPositionPercent}% is below minimum ${config.minPositionPercent}%`,
                code: 'POSITION_BELOW_MIN',
            };
        }
    }

    // 检查最高仓位
    if (config.maxPositionPercent) {
        const max = new Decimal(config.maxPositionPercent);
        if (position.gt(max)) {
            return {
                blocked: true,
                reason: `Position ${ctx.currentPositionPercent}% is above maximum ${config.maxPositionPercent}%`,
                code: 'POSITION_ABOVE_MAX',
            };
        }
    }

    return { blocked: false };
}

/**
 * BoundsGate 完整检查
 */
export function boundsGate(
    config: BoundsGateConfig,
    ctx: BoundsGateContext
): GateResult {
    // 价格检查
    const priceResult = checkPriceBounds(config, ctx);
    if (priceResult.blocked) {
        return priceResult;
    }

    // 仓位检查
    const positionResult = checkPositionBounds(config, ctx);
    if (positionResult.blocked) {
        return positionResult;
    }

    return { blocked: false };
}
