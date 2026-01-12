/**
 * RiskGate - 买卖开关检查
 * 
 * 来源：docs/spec/conditions.md §5 Gate
 * 
 * 职责：
 * - 根据 enableBuy/enableSell 开关阻止交易
 */

export interface RiskGateConfig {
    enableBuy?: boolean;
    enableSell?: boolean;
}

export interface RiskGateContext {
    side: 'buy' | 'sell';
}

export type GateResult =
    | { blocked: false }
    | { blocked: true; reason: string; code: string };

/**
 * RiskGate 检查
 * 
 * 规则：
 * - enableBuy=false 时阻止买入
 * - enableSell=false 时阻止卖出
 */
export function riskGate(
    config: RiskGateConfig,
    ctx: RiskGateContext
): GateResult {
    // 默认都允许
    const enableBuy = config.enableBuy ?? true;
    const enableSell = config.enableSell ?? true;

    if (ctx.side === 'buy' && !enableBuy) {
        return {
            blocked: true,
            reason: 'Buy is disabled by risk gate',
            code: 'BUY_DISABLED',
        };
    }

    if (ctx.side === 'sell' && !enableSell) {
        return {
            blocked: true,
            reason: 'Sell is disabled by risk gate',
            code: 'SELL_DISABLED',
        };
    }

    return { blocked: false };
}
