/**
 * FloorPriceGate - 保底价检查（风控）
 * 
 * 来源：docs/spec/conditions.md §5 Gate
 * 
 * 职责：
 * - 当价格跌破保底价时，阻止买入
 */

import { Decimal } from 'decimal.js';

export interface FloorPriceGateConfig {
    enableFloorPrice?: boolean;
    floorPrice?: string;
}

export interface FloorPriceGateContext {
    currentPrice: string;
    side: 'buy' | 'sell';
}

export type GateResult =
    | { blocked: false }
    | { blocked: true; reason: string; code: string };

/**
 * FloorPriceGate 检查
 * 
 * 规则：当价格 < floorPrice 时，阻止买入（不阻止卖出）
 */
export function floorPriceGate(
    config: FloorPriceGateConfig,
    ctx: FloorPriceGateContext
): GateResult {
    if (!config.enableFloorPrice || !config.floorPrice) {
        return { blocked: false };
    }

    // 只检查买入
    if (ctx.side !== 'buy') {
        return { blocked: false };
    }

    const price = new Decimal(ctx.currentPrice);
    const floor = new Decimal(config.floorPrice);

    if (price.lt(floor)) {
        return {
            blocked: true,
            reason: `Price ${ctx.currentPrice} is below floor price ${config.floorPrice}, buy blocked`,
            code: 'FLOOR_PRICE_TRIGGERED',
        };
    }

    return { blocked: false };
}
