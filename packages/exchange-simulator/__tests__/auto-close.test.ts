/**
 * ACC-RISK-002: AutoClose（价格回撤）验收测试
 * 
 * 验收清单：
 * 1. 未触发前不改变 bot 状态
 * 2. 首次触发进入 STOPPING
 * 3. 重复检查不二次 bump
 * 4. 行情不可用不允许静默触发
 */

import { describe, it, expect } from 'vitest';
import {
    checkAutoClose,
    getReferencePrice,
    parseAutoCloseConfig,
} from '@crypto-strategy-hub/shared';

describe('ACC-RISK-002: AutoClose 纯函数测试', () => {
    describe('checkAutoClose', () => {
        it('should not trigger when not enabled', () => {
            const result = checkAutoClose(
                { enableAutoClose: false, autoCloseDrawdownPercent: '5' },
                { referencePrice: '100', lastPrice: '90', alreadyTriggered: false }
            );
            expect(result.shouldTrigger).toBe(false);
        });

        it('should not trigger when no drawdown percent set', () => {
            const result = checkAutoClose(
                { enableAutoClose: true },
                { referencePrice: '100', lastPrice: '90', alreadyTriggered: false }
            );
            expect(result.shouldTrigger).toBe(false);
        });

        it('should not trigger when already triggered', () => {
            const result = checkAutoClose(
                { enableAutoClose: true, autoCloseDrawdownPercent: '5' },
                { referencePrice: '100', lastPrice: '90', alreadyTriggered: true }
            );
            expect(result.shouldTrigger).toBe(false);
        });

        it('should not trigger when price above threshold', () => {
            // 参考价 100，阈值 5%，阈值价 = 95
            // 当前价 96 > 95，不触发
            const result = checkAutoClose(
                { enableAutoClose: true, autoCloseDrawdownPercent: '5' },
                { referencePrice: '100', lastPrice: '96', alreadyTriggered: false }
            );
            expect(result.shouldTrigger).toBe(false);
        });

        it('should trigger when price exactly at threshold', () => {
            // 参考价 100，阈值 5%，阈值价 = 95
            // 当前价 95 = 阈值，触发
            const result = checkAutoClose(
                { enableAutoClose: true, autoCloseDrawdownPercent: '5' },
                { referencePrice: '100', lastPrice: '95', alreadyTriggered: false }
            );
            expect(result.shouldTrigger).toBe(true);
            expect(result.reason).toBe('AUTO_CLOSE');
            expect(result.drawdownPercent).toBe('5.00');
        });

        it('should trigger when price below threshold', () => {
            // 参考价 100，阈值 5%，阈值价 = 95
            // 当前价 90 < 95，触发
            const result = checkAutoClose(
                { enableAutoClose: true, autoCloseDrawdownPercent: '5' },
                { referencePrice: '100', lastPrice: '90', alreadyTriggered: false }
            );
            expect(result.shouldTrigger).toBe(true);
            expect(result.reason).toBe('AUTO_CLOSE');
            expect(result.drawdownPercent).toBe('10.00'); // 实际回撤 10%
        });

        it('should handle decimal precision correctly', () => {
            // 参考价 580.50，阈值 3%，阈值价 = 563.085
            // 当前价 560 < 563.085，触发
            const result = checkAutoClose(
                { enableAutoClose: true, autoCloseDrawdownPercent: '3' },
                { referencePrice: '580.50', lastPrice: '560', alreadyTriggered: false }
            );
            expect(result.shouldTrigger).toBe(true);
        });
    });

    describe('getReferencePrice', () => {
        it('should use tickerLast when basePriceType is current', () => {
            const config = JSON.stringify({
                trigger: { basePriceType: 'current' },
            });
            const result = getReferencePrice(config, '580.00');
            expect(result).toBe('580.00');
        });

        it('should use basePrice when basePriceType is manual', () => {
            const config = JSON.stringify({
                trigger: { basePriceType: 'manual', basePrice: '600.00' },
            });
            const result = getReferencePrice(config, '580.00');
            expect(result).toBe('600.00');
        });

        it('should fall back to tickerLast when manual but no basePrice', () => {
            const config = JSON.stringify({
                trigger: { basePriceType: 'manual' },
            });
            const result = getReferencePrice(config, '580.00');
            expect(result).toBe('580.00');
        });

        it('should fall back to tickerLast on parse error', () => {
            const result = getReferencePrice('invalid json', '580.00');
            expect(result).toBe('580.00');
        });
    });

    describe('parseAutoCloseConfig', () => {
        it('should parse valid config', () => {
            const config = JSON.stringify({
                risk: {
                    enableAutoClose: true,
                    autoCloseDrawdownPercent: '5',
                },
            });
            const result = parseAutoCloseConfig(config);
            expect(result.enableAutoClose).toBe(true);
            expect(result.autoCloseDrawdownPercent).toBe('5');
        });

        it('should default to disabled on missing risk config', () => {
            const config = JSON.stringify({});
            const result = parseAutoCloseConfig(config);
            expect(result.enableAutoClose).toBe(false);
        });

        it('should handle invalid JSON', () => {
            const result = parseAutoCloseConfig('invalid');
            expect(result.enableAutoClose).toBe(false);
        });
    });
});
