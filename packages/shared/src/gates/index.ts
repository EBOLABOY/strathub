/**
 * Gates - 条件阻断模块
 * 
 * 导出所有 Gate 实现
 */

// 只从 bounds-gate 导出 GateResult 类型一次
export type { GateResult } from './bounds-gate.js';

export {
    boundsGate,
    checkPriceBounds,
    checkPositionBounds,
    type BoundsGateConfig,
    type BoundsGateContext,
} from './bounds-gate.js';

export {
    floorPriceGate,
    type FloorPriceGateConfig,
    type FloorPriceGateContext,
} from './floor-price-gate.js';

export {
    riskGate,
    type RiskGateConfig,
    type RiskGateContext,
} from './risk-gate.js';
