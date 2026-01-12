/**
 * Preview Validation Service
 * 
 * 共享校验逻辑：供 preview/start/resume 复用
 * 
 * 遵循规则：
 * - 纯函数核心
 * - 交易所数据获取失败 → 503
 * - 配置校验错误 → 422
 */

import {
    calculatePreview,
    hasBlockingErrors,
    type GridConfig,
    type PreviewMarketInfo,
    type PreviewTickerInfo,
    type PreviewBalanceInfo,
    type PreviewResult,
} from '@crypto-strategy-hub/shared';
import { mockMarketDataProvider, type MarketDataProvider } from '@crypto-strategy-hub/market-data';
import { createApiError } from '../middleware/error-handler.js';

// 重新导出类型供 bots.ts 使用
export type { PreviewMarketInfo, PreviewTickerInfo, PreviewBalanceInfo } from '@crypto-strategy-hub/shared';
export type { MarketDataProvider } from '@crypto-strategy-hub/market-data';

export interface ValidationContext {
    symbol: string;
    configJson: string;
    configOverride?: Partial<GridConfig>;
    marketDataProvider?: MarketDataProvider;
}

export interface ValidationResult {
    preview: PreviewResult;
    config: GridConfig;
    hasErrors: boolean;
}

/**
 * 解析并合并配置
 */
export function parseAndMergeConfig(
    configJson: string,
    configOverride?: Partial<GridConfig>
): GridConfig {
    let config: GridConfig;

    try {
        config = JSON.parse(configJson) as GridConfig;
    } catch {
        throw createApiError('Invalid config JSON', 422, 'INVALID_CONFIG');
    }

    // 合并 configOverride（不落库）
    if (configOverride) {
        config = deepMerge(config, configOverride);
    }

    return config;
}

/**
 * 深度合并对象（带原型污染防护）
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
    const result = { ...target };

    // 使用 Object.keys 而非 for...in，避免遍历原型链
    for (const key of Object.keys(source) as Array<keyof T>) {
        // 原型污染防护
        if (DANGEROUS_KEYS.has(key as string)) {
            continue;
        }

        // 确保 key 是 source 自身的属性
        if (!Object.prototype.hasOwnProperty.call(source, key)) {
            continue;
        }

        const sourceValue = source[key];
        const targetValue = target[key];

        if (
            sourceValue !== undefined &&
            typeof sourceValue === 'object' &&
            sourceValue !== null &&
            !Array.isArray(sourceValue) &&
            typeof targetValue === 'object' &&
            targetValue !== null
        ) {
            (result as Record<string, unknown>)[key as string] = deepMerge(
                targetValue as object,
                sourceValue as object
            );
        } else if (sourceValue !== undefined) {
            (result as Record<string, unknown>)[key as string] = sourceValue;
        }
    }

    return result;
}


/**
 * 执行配置校验（共享逻辑）
 * 
 * @throws 503 如果交易所数据不可用
 * @returns ValidationResult
 */
export async function validateBotConfig(
    ctx: ValidationContext
): Promise<ValidationResult> {
    const provider = ctx.marketDataProvider ?? mockMarketDataProvider;

    // 1. 解析配置
    const config = parseAndMergeConfig(ctx.configJson, ctx.configOverride);

    // 2. 获取市场数据
    let market: PreviewMarketInfo;
    let ticker: PreviewTickerInfo;
    let balance: PreviewBalanceInfo | undefined;

    try {
        market = await provider.getMarketInfo(ctx.symbol);
    } catch (error) {
        throw createApiError(
            `Failed to get market info: ${(error as Error).message}`,
            503,
            'EXCHANGE_UNAVAILABLE'
        );
    }

    try {
        ticker = await provider.getTicker(ctx.symbol);
    } catch (error) {
        throw createApiError(
            `Failed to get ticker: ${(error as Error).message}`,
            503,
            'EXCHANGE_UNAVAILABLE'
        );
    }

    try {
        balance = await provider.getBalance(ctx.symbol);
    } catch {
        // 余额获取失败不阻断，Preview 会返回 WARN
        balance = undefined;
    }

    // 3. 纯函数计算
    const preview = calculatePreview(config, market, ticker, balance);

    return {
        preview,
        config,
        hasErrors: hasBlockingErrors(preview),
    };
}

/**
 * 校验配置并阻断 ERROR
 * 
 * @throws 422 如果存在校验错误
 * @throws 503 如果交易所数据不可用
 */
export async function validateAndBlockOnError(
    ctx: ValidationContext
): Promise<ValidationResult> {
    const result = await validateBotConfig(ctx);

    if (result.hasErrors) {
        // 收集所有 ERROR 级别的 issue
        const errors = result.preview.issues
            .filter(i => i.severity === 'ERROR')
            .map(i => `${i.code}: ${i.message}`)
            .join('; ');

        throw createApiError(
            `Config validation failed: ${errors}`,
            422,
            'CONFIG_VALIDATION_ERROR'
        );
    }

    return result;
}
