/**
 * AutoClose 纯函数判定 - ACC-RISK-002
 * 
 * 规格：
 * - 价格回撤触发：lastPrice <= referencePrice * (1 - drawdownPercent/100)
 * - 只触发一次：triggeredAt != null 时不再触发
 * - 行情不可用时不允许静默触发
 */

import { Decimal } from 'decimal.js';

export interface AutoCloseConfig {
    enableAutoClose?: boolean;
    autoCloseDrawdownPercent?: string; // 例如 "5" 表示 -5%
}

export interface AutoCloseContext {
    referencePrice: string;
    lastPrice: string;
    alreadyTriggered: boolean;
}

export interface AutoCloseResult {
    shouldTrigger: boolean;
    reason?: string;
    drawdownPercent?: string;
}

/**
 * AutoClose 判定（纯函数）
 * 
 * @returns 是否应该触发 RISK_TRIGGERED(AUTO_CLOSE)
 */
export function checkAutoClose(
    config: AutoCloseConfig,
    ctx: AutoCloseContext
): AutoCloseResult {
    // 未开启
    if (!config.enableAutoClose) {
        return { shouldTrigger: false };
    }

    // 没有设置阈值
    if (!config.autoCloseDrawdownPercent) {
        return { shouldTrigger: false };
    }

    // 已经触发过
    if (ctx.alreadyTriggered) {
        return { shouldTrigger: false };
    }

    // 解析价格（防御性处理：非数字会抛异常）
    let ref: InstanceType<typeof Decimal>;
    let last: InstanceType<typeof Decimal>;
    let pct: InstanceType<typeof Decimal>;
    try {
        ref = new Decimal(ctx.referencePrice);
        last = new Decimal(ctx.lastPrice);
        pct = new Decimal(config.autoCloseDrawdownPercent!);
    } catch (error) {
        // 价格解析失败 = 行情数据异常，抛出错误让上层处理
        throw new Error(`Invalid price data: ref=${ctx.referencePrice}, last=${ctx.lastPrice}`);
    }

    // 计算阈值价格
    const threshold = ref.mul(Decimal.sub(1, pct.div(100)));

    // 计算实际回撤
    const actualDrawdown = ref.sub(last).div(ref).mul(100);

    // 触发条件：lastPrice <= referencePrice * (1 - pct/100)
    if (last.lte(threshold)) {
        return {
            shouldTrigger: true,
            reason: 'AUTO_CLOSE',
            drawdownPercent: actualDrawdown.toFixed(2),
        };
    }

    return { shouldTrigger: false };
}

/**
 * 解析配置中的 AutoClose 配置
 */
export function parseAutoCloseConfig(configJson: string): AutoCloseConfig {
    try {
        const config = JSON.parse(configJson);
        return {
            enableAutoClose: config.risk?.enableAutoClose ?? false,
            autoCloseDrawdownPercent: config.risk?.autoCloseDrawdownPercent,
        };
    } catch {
        return { enableAutoClose: false };
    }
}

/**
 * 获取参考价格
 * 
 * 规则：
 * - basePriceType=manual → trigger.basePrice
 * - basePriceType=current → 传入的 tickerLast
 */
export function getReferencePrice(
    configJson: string,
    tickerLast: string
): string {
    try {
        const config = JSON.parse(configJson);
        const basePriceType = config.trigger?.basePriceType ?? 'current';

        if (basePriceType === 'manual' && config.trigger?.basePrice) {
            return config.trigger.basePrice;
        }

        return tickerLast;
    } catch {
        return tickerLast;
    }
}
