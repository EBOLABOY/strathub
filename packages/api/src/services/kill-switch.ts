/**
 * Kill Switch Service - ACC-RISK-001
 * 
 * 规格：
 * - 只对 RUNNING/WAITING_TRIGGER 发起 STOP_REQUESTED
 * - 幂等：重复 enable 不重复 bump bot 的 statusVersion
 * - 并发安全：对每个 bot 用 statusVersion 做 CAS
 */

import { prisma, Prisma } from '@crypto-strategy-hub/database';
import { BotStatus } from '@crypto-strategy-hub/shared';

export interface KillSwitchState {
    enabled: boolean;
    enabledAt: Date | null;
    reason: string | null;
}

export interface KillSwitchEnableResult {
    enabled: boolean;
    enabledAt: Date;
    reason: string;
    affectedBots: number;
}

// 需要停止的状态（只停会交易的）
const STOPPABLE_STATUSES = [BotStatus.RUNNING, BotStatus.WAITING_TRIGGER];

/**
 * 获取 Kill Switch 状态
 */
export async function getKillSwitchState(userId: string): Promise<KillSwitchState> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            killSwitchEnabled: true,
            killSwitchEnabledAt: true,
            killSwitchReason: true,
        },
    });

    if (!user) {
        throw new Error('User not found');
    }

    return {
        enabled: user.killSwitchEnabled,
        enabledAt: user.killSwitchEnabledAt,
        reason: user.killSwitchReason,
    };
}

/**
 * 启用 Kill Switch（幂等）
 * 
 * 行为：
 * 1. 设置 killSwitchEnabled = true
 * 2. 对 RUNNING/WAITING_TRIGGER 的 bots 发起 STOP_REQUESTED
 * 3. 每个 bot 使用 CAS (statusVersion) 保证只推进一次
 */
export async function enableKillSwitch(
    userId: string,
    reason: string = 'MANUAL'
): Promise<KillSwitchEnableResult> {
    const now = new Date();

    // 1. 原子更新 User 的 kill switch 状态（并发安全 + 幂等）
    // 使用条件更新：只有 disabled -> enabled 才写入 enabledAt/reason，避免并发 enable 覆盖。
    await prisma.user.updateMany({
        where: { id: userId, killSwitchEnabled: false },
        data: {
            killSwitchEnabled: true,
            killSwitchEnabledAt: now,
            killSwitchReason: reason,
        },
    });

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            killSwitchEnabled: true,
            killSwitchEnabledAt: true,
            killSwitchReason: true,
        },
    });

    if (!user) throw new Error('User not found');

    // 2. 获取需要停止的 bots
    const botsToStop = await prisma.bot.findMany({
        where: {
            userId,
            status: { in: STOPPABLE_STATUSES },
        },
        select: {
            id: true,
            statusVersion: true,
        },
    });

    // 3. 对每个 bot 执行 CAS 更新（幂等）
    let affectedCount = 0;

    for (const bot of botsToStop) {
        try {
            // CAS: 只有 statusVersion 匹配才更新
            await prisma.bot.update({
                where: {
                    id: bot.id,
                    statusVersion: bot.statusVersion,
                },
                data: {
                    status: BotStatus.STOPPING,
                    statusVersion: bot.statusVersion + 1,
                    lastError: `KILL_SWITCH: ${reason}`,
                },
            });
            affectedCount++;
        } catch (error) {
            // CAS 失败（其他进程已更新）- 幂等，忽略
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2025') {
                    // Record not found (CAS failed) - 已经被其他进程处理
                    continue;
                }
            }
            throw error;
        }
    }

    return {
        enabled: true,
        enabledAt: user.killSwitchEnabledAt ?? now,
        reason: user.killSwitchReason ?? reason,
        affectedBots: affectedCount,
    };
}

/**
 * 禁用 Kill Switch（幂等）
 */
export async function disableKillSwitch(userId: string): Promise<KillSwitchState> {
    await prisma.user.update({
        where: { id: userId },
        data: {
            killSwitchEnabled: false,
            // 不清除 enabledAt 和 reason（保留审计记录）
        },
    });

    return getKillSwitchState(userId);
}

/**
 * 检查 Kill Switch 是否阻断操作
 * 
 * 用于 start/resume guard
 */
export async function isKillSwitchBlocking(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { killSwitchEnabled: true },
    });

    return user?.killSwitchEnabled ?? false;
}
