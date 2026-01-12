/**
 * ACC-API-001: Preview 真逻辑测试
 * 
 * 验收场景：
 * - 无副作用（只读/不写 DB/不下单）
 * - 校验完整（跨字段互斥 + precision/minAmount/minNotional）
 * - 结果可解释可复现
 */

import { describe, it, expect } from 'vitest';
import {
    calculatePreview,
    hasBlockingErrors,
    type GridConfig,
    type PreviewMarketInfo,
    type PreviewTickerInfo,
    type PreviewBalanceInfo,
} from '@crypto-strategy-hub/shared';

const MARKET: PreviewMarketInfo = {
    symbol: 'BNB/USDT',
    pricePrecision: 2,
    amountPrecision: 4,
    minAmount: '0.01',
    minNotional: '10',
};

const TICKER: PreviewTickerInfo = {
    last: '580.00',
};

const BALANCE: PreviewBalanceInfo = {
    quote: 'USDT',
    free: '1000.00',
};

describe('ACC-API-001: Preview 真逻辑', () => {
    describe('基础计算', () => {
        it('should calculate trigger prices correctly with percent mode', () => {
            const config: GridConfig = {
                trigger: {
                    gridType: 'percent',
                    basePriceType: 'current',
                    riseSell: '0.85',
                    fallBuy: '0.85',
                },
                order: { orderType: 'limit' },
                sizing: {
                    amountMode: 'amount',
                    gridSymmetric: true,
                    symmetric: { orderQuantity: '100' },
                },
            };

            const result = calculatePreview(config, MARKET, TICKER, BALANCE);

            expect(result.basePrice).toBe('580.00');
            expect(result.buyTriggerPrice).toBe('575.07'); // 580 * (1 - 0.0085)
            expect(result.sellTriggerPrice).toBe('584.93'); // 580 * (1 + 0.0085)
            expect(result.lines.length).toBeGreaterThan(0);
            expect(result.orders.length).toBe(2);
        });

        it('should calculate trigger prices correctly with price mode', () => {
            const config: GridConfig = {
                trigger: {
                    gridType: 'price',
                    basePriceType: 'current',
                    riseSell: '5',
                    fallBuy: '5',
                },
                order: { orderType: 'limit' },
                sizing: {
                    amountMode: 'amount',
                    gridSymmetric: true,
                    symmetric: { orderQuantity: '100' },
                },
            };

            const result = calculatePreview(config, MARKET, TICKER, BALANCE);

            expect(result.basePrice).toBe('580.00');
            expect(result.buyTriggerPrice).toBe('575.00');
            expect(result.sellTriggerPrice).toBe('585.00');
        });

        it('should use manual basePrice when specified', () => {
            const config: GridConfig = {
                trigger: {
                    gridType: 'percent',
                    basePriceType: 'manual',
                    basePrice: '600.00',
                    riseSell: '1',
                    fallBuy: '1',
                },
                order: { orderType: 'limit' },
                sizing: {
                    amountMode: 'amount',
                    gridSymmetric: true,
                    symmetric: { orderQuantity: '100' },
                },
            };

            const result = calculatePreview(config, MARKET, TICKER, BALANCE);

            expect(result.basePrice).toBe('600.00');
            expect(result.buyTriggerPrice).toBe('594.00');
            expect(result.sellTriggerPrice).toBe('606.00');
        });
    });

    describe('V1 不支持的 basePriceType', () => {
        it('should return ERROR for basePriceType=cost', () => {
            const config: GridConfig = {
                trigger: {
                    gridType: 'percent',
                    basePriceType: 'cost',
                    riseSell: '1',
                    fallBuy: '1',
                },
                order: { orderType: 'limit' },
                sizing: {
                    amountMode: 'amount',
                    gridSymmetric: true,
                    symmetric: { orderQuantity: '100' },
                },
            };

            const result = calculatePreview(config, MARKET, TICKER, BALANCE);

            expect(hasBlockingErrors(result)).toBe(true);
            const costError = result.issues.find(i => i.code === 'UNSUPPORTED_BASE_PRICE_TYPE');
            expect(costError).toBeDefined();
            expect(costError!.severity).toBe('ERROR');
        });

        it('should return ERROR for basePriceType=avg_24h', () => {
            const config: GridConfig = {
                trigger: {
                    gridType: 'percent',
                    basePriceType: 'avg_24h',
                    riseSell: '1',
                    fallBuy: '1',
                },
                order: { orderType: 'limit' },
                sizing: {
                    amountMode: 'amount',
                    gridSymmetric: true,
                    symmetric: { orderQuantity: '100' },
                },
            };

            const result = calculatePreview(config, MARKET, TICKER, BALANCE);

            expect(hasBlockingErrors(result)).toBe(true);
        });
    });

    describe('amountMode=percent', () => {
        it('should calculate order amount based on free quote balance', () => {
            const config: GridConfig = {
                trigger: {
                    gridType: 'percent',
                    basePriceType: 'current',
                    riseSell: '1',
                    fallBuy: '1',
                },
                order: { orderType: 'limit' },
                sizing: {
                    amountMode: 'percent',
                    gridSymmetric: true,
                    symmetric: { orderQuantity: '10' }, // 10%
                },
            };

            const result = calculatePreview(config, MARKET, TICKER, BALANCE);

            // 10% of 1000 = 100 USDT
            expect(result.orders[0]!.quoteAmount).toBe('100.00');
        });

        it('should return WARN when balance unavailable', () => {
            const config: GridConfig = {
                trigger: {
                    gridType: 'percent',
                    basePriceType: 'current',
                    riseSell: '1',
                    fallBuy: '1',
                },
                order: { orderType: 'limit' },
                sizing: {
                    amountMode: 'percent',
                    gridSymmetric: true,
                    symmetric: { orderQuantity: '10' },
                },
            };

            const result = calculatePreview(config, MARKET, TICKER); // no balance

            const warn = result.issues.find(i => i.code === 'BALANCE_UNAVAILABLE');
            expect(warn).toBeDefined();
            expect(warn!.severity).toBe('WARN');
        });
    });

    describe('minAmount/minNotional 校验', () => {
        it('should return ERROR when below minAmount', () => {
            const config: GridConfig = {
                trigger: {
                    gridType: 'percent',
                    basePriceType: 'current',
                    riseSell: '1',
                    fallBuy: '1',
                },
                order: { orderType: 'limit' },
                sizing: {
                    amountMode: 'amount',
                    gridSymmetric: true,
                    symmetric: { orderQuantity: '1' }, // 1 USDT ≈ 0.0017 BNB < minAmount 0.01
                },
            };

            const result = calculatePreview(config, MARKET, TICKER, BALANCE);

            const error = result.issues.find(i => i.code === 'BELOW_MIN_AMOUNT');
            expect(error).toBeDefined();
            expect(error!.severity).toBe('ERROR');
        });

        it('should return ERROR when below minNotional', () => {
            const config: GridConfig = {
                trigger: {
                    gridType: 'percent',
                    basePriceType: 'current',
                    riseSell: '1',
                    fallBuy: '1',
                },
                order: { orderType: 'limit' },
                sizing: {
                    amountMode: 'amount',
                    gridSymmetric: true,
                    symmetric: { orderQuantity: '5' }, // 5 USDT < minNotional 10
                },
            };

            const result = calculatePreview(config, MARKET, TICKER, BALANCE);

            const error = result.issues.find(i => i.code === 'BELOW_MIN_NOTIONAL');
            expect(error).toBeDefined();
        });

        it('should pass validation when above minimums', () => {
            const config: GridConfig = {
                trigger: {
                    gridType: 'percent',
                    basePriceType: 'current',
                    riseSell: '1',
                    fallBuy: '1',
                },
                order: { orderType: 'limit' },
                sizing: {
                    amountMode: 'amount',
                    gridSymmetric: true,
                    symmetric: { orderQuantity: '100' },
                },
            };

            const result = calculatePreview(config, MARKET, TICKER, BALANCE);

            expect(hasBlockingErrors(result)).toBe(false);
        });
    });

    describe('estimates', () => {
        it('should calculate estimates when no errors', () => {
            const config: GridConfig = {
                trigger: {
                    gridType: 'percent',
                    basePriceType: 'current',
                    riseSell: '1',
                    fallBuy: '1',
                },
                order: { orderType: 'limit' },
                sizing: {
                    amountMode: 'amount',
                    gridSymmetric: true,
                    symmetric: { orderQuantity: '100' },
                },
            };

            const result = calculatePreview(config, MARKET, TICKER, BALANCE);

            expect(result.estimates).toBeDefined();
            expect(result.estimates!.spreadQuote).toBeDefined();
            expect(result.estimates!.estimatedNetProfitQuoteRoundTrip).toBeDefined();
            expect(result.estimates!.notes.length).toBeGreaterThan(0);
        });

        it('should not calculate estimates when has errors', () => {
            const config: GridConfig = {
                trigger: {
                    gridType: 'percent',
                    basePriceType: 'cost', // V1 不支持
                    riseSell: '1',
                    fallBuy: '1',
                },
                order: { orderType: 'limit' },
                sizing: {
                    amountMode: 'amount',
                    gridSymmetric: true,
                    symmetric: { orderQuantity: '100' },
                },
            };

            const result = calculatePreview(config, MARKET, TICKER, BALANCE);

            expect(result.estimates).toBeUndefined();
        });
    });

    describe('无副作用', () => {
        it('should be a pure function with same inputs producing same outputs', () => {
            const config: GridConfig = {
                trigger: {
                    gridType: 'percent',
                    basePriceType: 'current',
                    riseSell: '1',
                    fallBuy: '1',
                },
                order: { orderType: 'limit' },
                sizing: {
                    amountMode: 'amount',
                    gridSymmetric: true,
                    symmetric: { orderQuantity: '100' },
                },
            };

            const result1 = calculatePreview(config, MARKET, TICKER, BALANCE);
            const result2 = calculatePreview(config, MARKET, TICKER, BALANCE);

            expect(result1.basePrice).toBe(result2.basePrice);
            expect(result1.buyTriggerPrice).toBe(result2.buyTriggerPrice);
            expect(result1.sellTriggerPrice).toBe(result2.sellTriggerPrice);
            expect(result1.issues.length).toBe(result2.issues.length);
            expect(result1.orders.length).toBe(result2.orders.length);
        });
    });

    describe('hasBlockingErrors', () => {
        it('should return true when has ERROR severity issues', () => {
            const result = calculatePreview(
                {
                    trigger: {
                        gridType: 'percent',
                        basePriceType: 'cost',
                        riseSell: '1',
                        fallBuy: '1',
                    },
                    order: { orderType: 'limit' },
                    sizing: { amountMode: 'amount', gridSymmetric: true, symmetric: { orderQuantity: '100' } },
                },
                MARKET,
                TICKER,
                BALANCE
            );

            expect(hasBlockingErrors(result)).toBe(true);
        });

        it('should return false when only has WARN severity issues', () => {
            const result = calculatePreview(
                {
                    trigger: {
                        gridType: 'percent',
                        basePriceType: 'current',
                        riseSell: '1',
                        fallBuy: '1',
                    },
                    order: { orderType: 'limit' },
                    sizing: { amountMode: 'percent', gridSymmetric: true, symmetric: { orderQuantity: '10' } },
                },
                MARKET,
                TICKER
                // no balance - will produce WARN
            );

            // WARN only, no ERROR
            const hasError = result.issues.some(i => i.severity === 'ERROR');
            expect(hasError).toBe(false);
            expect(hasBlockingErrors(result)).toBe(false);
        });
    });
});
