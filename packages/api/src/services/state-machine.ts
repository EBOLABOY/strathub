/**
 * Bot State Machine Service
 * 
 * 来源：docs/spec/state-machine.md
 */

import { BotStatus } from '@crypto-strategy-hub/shared';

export type StateTransitionEvent =
    | 'START'
    | 'TRIGGER_HIT'
    | 'PAUSE'
    | 'RESUME'
    | 'STOP'
    | 'RISK_TRIGGERED'
    | 'KILL_SWITCH'
    | 'FATAL_ERROR'
    | 'STOPPED_COMPLETE';

export interface StateTransitionResult {
    valid: boolean;
    targetStatus?: BotStatus;
    idempotent?: boolean;
    /** 需要调用方提供配置来决定目标状态 */
    needsConfigCheck?: boolean;
}

/**
 * 状态转移表
 * Key: `${fromStatus}:${event}`
 * Value: targetStatus
 */
const TRANSITIONS: Record<string, BotStatus | 'RUNNING_OR_WAITING'> = {
    // DRAFT
    'DRAFT:START': 'RUNNING_OR_WAITING',

    // WAITING_TRIGGER
    'WAITING_TRIGGER:TRIGGER_HIT': BotStatus.RUNNING,
    'WAITING_TRIGGER:PAUSE': BotStatus.PAUSED,
    'WAITING_TRIGGER:STOP': BotStatus.STOPPING,

    // RUNNING
    'RUNNING:PAUSE': BotStatus.PAUSED,
    'RUNNING:STOP': BotStatus.STOPPING,

    // PAUSED
    'PAUSED:RESUME': 'RUNNING_OR_WAITING',
    'PAUSED:STOP': BotStatus.STOPPING,

    // STOPPING
    'STOPPING:STOPPED_COMPLETE': BotStatus.STOPPED,

    // 全局事件（从任何状态）
    '*:RISK_TRIGGERED': BotStatus.STOPPING,
    '*:KILL_SWITCH': BotStatus.STOPPING,
    '*:FATAL_ERROR': BotStatus.ERROR,
};

/**
 * 幂等事件映射
 * 如果已在目标状态，直接返回成功
 */
const IDEMPOTENT_EVENTS: Record<StateTransitionEvent, BotStatus[]> = {
    START: [BotStatus.RUNNING, BotStatus.WAITING_TRIGGER],
    PAUSE: [BotStatus.PAUSED],
    STOP: [BotStatus.STOPPING, BotStatus.STOPPED],
    RESUME: [BotStatus.RUNNING, BotStatus.WAITING_TRIGGER],
    TRIGGER_HIT: [],
    RISK_TRIGGERED: [],
    KILL_SWITCH: [],
    FATAL_ERROR: [],
    STOPPED_COMPLETE: [],
};

/**
 * 触发条件配置（简化版）
 */
export interface TriggerConfig {
    /** 是否有触发条件（有则进入 WAITING_TRIGGER，无则直接 RUNNING） */
    hasTriggerCondition: boolean;
}

/**
 * 验证状态转移（不含配置检查）
 */
export function validateStateTransition(
    currentStatus: BotStatus,
    event: StateTransitionEvent
): StateTransitionResult {
    // 检查幂等
    const idempotentStatuses = IDEMPOTENT_EVENTS[event];
    if (idempotentStatuses?.includes(currentStatus)) {
        return { valid: true, targetStatus: currentStatus, idempotent: true };
    }

    // 检查具体转移
    const key = `${currentStatus}:${event}`;
    let target = TRANSITIONS[key];

    // 检查全局事件
    if (!target) {
        const globalKey = `*:${event}`;
        target = TRANSITIONS[globalKey];
    }

    if (!target) {
        return { valid: false };
    }

    // RUNNING_OR_WAITING 需要配置检查
    if (target === 'RUNNING_OR_WAITING') {
        return { valid: true, needsConfigCheck: true };
    }

    return { valid: true, targetStatus: target as BotStatus };
}

/**
 * 根据配置决定目标状态（RUNNING or WAITING_TRIGGER）
 * 
 * 数据驱动：检查配置中是否有触发条件
 */
export function resolveRunningOrWaiting(config: TriggerConfig): BotStatus {
    return config.hasTriggerCondition
        ? BotStatus.WAITING_TRIGGER
        : BotStatus.RUNNING;
}

/**
 * 从 configJson 解析触发条件
 */
export function parseTriggerConfig(configJson: string): TriggerConfig {
    try {
        const config = JSON.parse(configJson);

        // 检查是否有触发条件
        // 依据 GridStrategyConfigV1：有 trigger.basePriceType 且非空 = 有触发条件
        const hasTriggerCondition = !!(
            config?.trigger?.basePriceType &&
            (config.trigger.riseSell || config.trigger.fallBuy)
        );

        return { hasTriggerCondition };
    } catch {
        // 解析失败默认无触发条件（直接 RUNNING）
        return { hasTriggerCondition: false };
    }
}

/**
 * 检查是否允许修改配置
 */
export function canModifyConfig(status: BotStatus): boolean {
    const allowedStatuses: BotStatus[] = [
        BotStatus.DRAFT,
        BotStatus.PAUSED,
        BotStatus.STOPPED,
        BotStatus.ERROR,
    ];
    return allowedStatuses.includes(status);
}
