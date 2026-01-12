/**
 * UNIT-GATE-001: BoundsGate 测试
 * UNIT-RISK-001: FloorPriceGate 测试
 * UNIT-RISK-002: RiskGate 测试
 * 
 * 注意：这些是 Gate 组件的单元测试，
 * 不是 top12-scenarios.md 中的 ACC-RISK-001（Kill Switch）和 ACC-RISK-002（AutoClose）
 */

import { describe, it, expect } from 'vitest';
import {
    boundsGate,
    checkPriceBounds,
    checkPositionBounds,
    floorPriceGate,
    riskGate,
} from '@crypto-strategy-hub/shared';

describe('UNIT-GATE-001: BoundsGate', () => {
    describe('checkPriceBounds', () => {
        it('should pass when price is within bounds', () => {
            const result = checkPriceBounds(
                { priceMin: '500', priceMax: '600' },
                { currentPrice: '550' }
            );
            expect(result.blocked).toBe(false);
        });

        it('should block when price is below minimum', () => {
            const result = checkPriceBounds(
                { priceMin: '500', priceMax: '600' },
                { currentPrice: '490' }
            );
            expect(result.blocked).toBe(true);
            if (result.blocked) {
                expect(result.code).toBe('PRICE_BELOW_MIN');
            }
        });

        it('should block when price is above maximum', () => {
            const result = checkPriceBounds(
                { priceMin: '500', priceMax: '600' },
                { currentPrice: '650' }
            );
            expect(result.blocked).toBe(true);
            if (result.blocked) {
                expect(result.code).toBe('PRICE_ABOVE_MAX');
            }
        });

        it('should pass when only priceMin is set and price is above', () => {
            const result = checkPriceBounds(
                { priceMin: '500' },
                { currentPrice: '550' }
            );
            expect(result.blocked).toBe(false);
        });

        it('should pass when only priceMax is set and price is below', () => {
            const result = checkPriceBounds(
                { priceMax: '600' },
                { currentPrice: '550' }
            );
            expect(result.blocked).toBe(false);
        });
    });

    describe('checkPositionBounds', () => {
        it('should pass when position is within bounds', () => {
            const result = checkPositionBounds(
                { minPositionPercent: '10', maxPositionPercent: '80' },
                { currentPrice: '580', currentPositionPercent: '50' }
            );
            expect(result.blocked).toBe(false);
        });

        it('should block when position is below minimum', () => {
            const result = checkPositionBounds(
                { minPositionPercent: '20', maxPositionPercent: '80' },
                { currentPrice: '580', currentPositionPercent: '10' }
            );
            expect(result.blocked).toBe(true);
            if (result.blocked) {
                expect(result.code).toBe('POSITION_BELOW_MIN');
            }
        });

        it('should block when position is above maximum', () => {
            const result = checkPositionBounds(
                { minPositionPercent: '20', maxPositionPercent: '80' },
                { currentPrice: '580', currentPositionPercent: '90' }
            );
            expect(result.blocked).toBe(true);
            if (result.blocked) {
                expect(result.code).toBe('POSITION_ABOVE_MAX');
            }
        });

        it('should pass when position is not provided', () => {
            const result = checkPositionBounds(
                { minPositionPercent: '20', maxPositionPercent: '80' },
                { currentPrice: '580' }
            );
            expect(result.blocked).toBe(false);
        });
    });

    describe('boundsGate (combined)', () => {
        it('should check price first, then position', () => {
            // Price out of bounds takes priority
            const result = boundsGate(
                { priceMin: '600', minPositionPercent: '50' },
                { currentPrice: '550', currentPositionPercent: '60' }
            );
            expect(result.blocked).toBe(true);
            if (result.blocked) {
                expect(result.code).toBe('PRICE_BELOW_MIN');
            }
        });

        it('should pass when both price and position are valid', () => {
            const result = boundsGate(
                { priceMin: '500', priceMax: '600', minPositionPercent: '10', maxPositionPercent: '90' },
                { currentPrice: '550', currentPositionPercent: '50' }
            );
            expect(result.blocked).toBe(false);
        });
    });
});

describe('UNIT-GATE-002: FloorPriceGate', () => {
    it('should pass when floor price is not enabled', () => {
        const result = floorPriceGate(
            { enableFloorPrice: false, floorPrice: '500' },
            { currentPrice: '400', side: 'buy' }
        );
        expect(result.blocked).toBe(false);
    });

    it('should pass when price is above floor', () => {
        const result = floorPriceGate(
            { enableFloorPrice: true, floorPrice: '500' },
            { currentPrice: '550', side: 'buy' }
        );
        expect(result.blocked).toBe(false);
    });

    it('should block buy when price is below floor', () => {
        const result = floorPriceGate(
            { enableFloorPrice: true, floorPrice: '500' },
            { currentPrice: '480', side: 'buy' }
        );
        expect(result.blocked).toBe(true);
        if (result.blocked) {
            expect(result.code).toBe('FLOOR_PRICE_TRIGGERED');
        }
    });

    it('should NOT block sell even when price is below floor', () => {
        const result = floorPriceGate(
            { enableFloorPrice: true, floorPrice: '500' },
            { currentPrice: '480', side: 'sell' }
        );
        expect(result.blocked).toBe(false);
    });
});

describe('UNIT-GATE-003: RiskGate', () => {
    it('should pass when both buy and sell are enabled', () => {
        const result = riskGate(
            { enableBuy: true, enableSell: true },
            { side: 'buy' }
        );
        expect(result.blocked).toBe(false);
    });

    it('should block buy when enableBuy is false', () => {
        const result = riskGate(
            { enableBuy: false, enableSell: true },
            { side: 'buy' }
        );
        expect(result.blocked).toBe(true);
        if (result.blocked) {
            expect(result.code).toBe('BUY_DISABLED');
        }
    });

    it('should block sell when enableSell is false', () => {
        const result = riskGate(
            { enableBuy: true, enableSell: false },
            { side: 'sell' }
        );
        expect(result.blocked).toBe(true);
        if (result.blocked) {
            expect(result.code).toBe('SELL_DISABLED');
        }
    });

    it('should default to enabled when not specified', () => {
        const result = riskGate(
            {},
            { side: 'buy' }
        );
        expect(result.blocked).toBe(false);
    });
});
