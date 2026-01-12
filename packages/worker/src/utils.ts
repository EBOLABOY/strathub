/**
 * Worker 工具函数
 * 
 * 纯函数，零 I/O 依赖
 */

import { createHash } from 'crypto';

/**
 * 计算 bot 状态 hash（确定性函数）
 * 
 * 规则：
 * - 输入只有 openOrderIds 和 tradeIds
 * - 排序后 JSON 序列化
 * - SHA256 取前 16 位
 * - 相同输入 → 相同输出
 */
export function computeStateHash(
    openOrderIds: string[],
    tradeIds: string[]
): { stateJson: string; stateHash: string } {
    const snapshotState = {
        openOrderIds: [...openOrderIds].sort(),
        tradeIds: [...tradeIds].sort(),
    };
    const stateJson = JSON.stringify(snapshotState);
    const stateHash = createHash('sha256').update(stateJson).digest('hex').slice(0, 16);

    return { stateJson, stateHash };
}
