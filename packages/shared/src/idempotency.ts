/**
 * 幂等键唯一事实来源
 *
 * 规则（V1）：
 * - clientOrderId = `${ORDER_PREFIX}-${botId.slice(0,8)}-${intentSeq}`
 * - 格式示例：gb1-a1b2c3d4-1
 *
 * 重要：
 * - 任何业务代码/测试里手写拼接一律算 bug
 * - 识别"我方订单"仍用 clientOrderId.startsWith(ORDER_PREFIX)
 *
 * @see docs/spec/idempotency.md
 */

import { ORDER_PREFIX } from './trading-executor.js';

/**
 * 生成 clientOrderId
 *
 * @param botId - Bot ID（至少 8 字符）
 * @param intentSeq - 意图序号（正整数）
 * @returns clientOrderId，格式：`gb1-{botId前8位}-{intentSeq}`
 * @throws 如果 botId 长度 < 8 或 intentSeq <= 0
 */
export function generateClientOrderId(botId: string, intentSeq: number): string {
    if (botId.length < 8) {
        throw new Error(`INVALID_BOT_ID: botId must be at least 8 characters, got ${botId.length}`);
    }
    if (!Number.isInteger(intentSeq) || intentSeq <= 0) {
        throw new Error(`INVALID_INTENT_SEQ: intentSeq must be a positive integer, got ${intentSeq}`);
    }

    return `${ORDER_PREFIX}-${botId.slice(0, 8)}-${intentSeq}`;
}

/**
 * 检查 clientOrderId 是否为我方订单
 *
 * @param clientOrderId - 待检查的 clientOrderId
 * @returns true 如果是我方订单
 */
export function isOurOrder(clientOrderId: string | undefined | null): boolean {
    return clientOrderId?.startsWith(ORDER_PREFIX) ?? false;
}
