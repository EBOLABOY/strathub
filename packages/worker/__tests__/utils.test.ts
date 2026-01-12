/**
 * computeStateHash 纯函数单测
 * 
 * 锁死口径：
 * 1. 相同输入 → 相同 hash
 * 2. 不同输入 → 不同 hash
 * 3. 输入顺序无关（排序后稳定）
 */

import { describe, it, expect } from 'vitest';
import { computeStateHash } from '../src/utils.js';

describe('computeStateHash 纯函数', () => {
    it('should produce same hash for same inputs', () => {
        const result1 = computeStateHash(['order-1', 'order-2'], ['trade-1']);
        const result2 = computeStateHash(['order-1', 'order-2'], ['trade-1']);

        expect(result1.stateHash).toBe(result2.stateHash);
        expect(result1.stateJson).toBe(result2.stateJson);
    });

    it('should produce different hash for different inputs', () => {
        const result1 = computeStateHash(['order-1'], ['trade-1']);
        const result2 = computeStateHash(['order-2'], ['trade-1']);
        const result3 = computeStateHash(['order-1'], ['trade-2']);

        expect(result1.stateHash).not.toBe(result2.stateHash);
        expect(result1.stateHash).not.toBe(result3.stateHash);
    });

    it('should be order-independent (sorted before hash)', () => {
        const result1 = computeStateHash(['order-2', 'order-1'], ['trade-2', 'trade-1']);
        const result2 = computeStateHash(['order-1', 'order-2'], ['trade-1', 'trade-2']);

        expect(result1.stateHash).toBe(result2.stateHash);
    });

    it('should handle empty arrays', () => {
        const result = computeStateHash([], []);

        expect(result.stateHash).toBeDefined();
        expect(result.stateJson).toBe('{"openOrderIds":[],"tradeIds":[]}');
    });

    it('should produce 16-char hex hash', () => {
        const result = computeStateHash(['order-1'], ['trade-1']);

        expect(result.stateHash).toHaveLength(16);
        expect(/^[0-9a-f]+$/.test(result.stateHash)).toBe(true);
    });
});
