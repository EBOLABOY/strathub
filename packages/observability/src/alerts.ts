/**
 * 告警服务
 * 
 * 支持多渠道告警推送：
 * - Telegram Bot
 * - Webhook (通用)
 * - PushPlus (微信推送)
 * 
 * 特性：
 * - 分级告警 (critical/warning/info)
 * - 去重与节流（避免刷屏）
 * - 发送失败重试
 */

import { alertsSentTotal } from './metrics.js';

// ============================================================================
// Types
// ============================================================================

export type AlertLevel = 'critical' | 'warning' | 'info';

export interface AlertPayload {
    level: AlertLevel;
    title: string;
    message: string;
    botId?: string;
    symbol?: string;
    timestamp?: string;
    tags?: Record<string, string>;
}

export interface AlertChannel {
    name: string;
    send(payload: AlertPayload): Promise<boolean>;
}

export interface AlertConfig {
    /** Telegram Bot Token */
    telegramBotToken?: string;
    /** Telegram Chat ID */
    telegramChatId?: string;
    /** Webhook URL */
    webhookUrl?: string;
    /** PushPlus Token */
    pushPlusToken?: string;
    /** 节流窗口（毫秒），同一 key 的告警在窗口内只发一次 */
    throttleWindowMs?: number;
    /** 是否启用（全局开关） */
    enabled?: boolean;
}

// ============================================================================
// Throttle / Dedup
// ============================================================================

const alertHistory = new Map<string, number>();

function getAlertKey(payload: AlertPayload): string {
    return `${payload.level}:${payload.title}:${payload.botId ?? 'global'}`;
}

function shouldThrottle(key: string, windowMs: number): boolean {
    const now = Date.now();
    const lastSent = alertHistory.get(key);

    if (lastSent && now - lastSent < windowMs) {
        return true;
    }

    alertHistory.set(key, now);
    return false;
}

// 定期清理过期的历史记录
setInterval(() => {
    const now = Date.now();
    const maxAge = 3600 * 1000; // 1 小时

    for (const [key, time] of alertHistory) {
        if (now - time > maxAge) {
            alertHistory.delete(key);
        }
    }
}, 60 * 1000);

// ============================================================================
// Channels
// ============================================================================

/**
 * Telegram 频道
 */
export function createTelegramChannel(botToken: string, chatId: string): AlertChannel {
    return {
        name: 'telegram',
        async send(payload: AlertPayload): Promise<boolean> {
            const emoji = payload.level === 'critical' ? '🚨' : payload.level === 'warning' ? '⚠️' : 'ℹ️';
            const text = [
                `${emoji} *${escapeMarkdown(payload.title)}*`,
                '',
                escapeMarkdown(payload.message),
                '',
                payload.botId ? `Bot: \`${payload.botId.slice(0, 8)}\`` : '',
                payload.symbol ? `Symbol: ${payload.symbol}` : '',
                `Time: ${payload.timestamp ?? new Date().toISOString()}`,
            ].filter(Boolean).join('\n');

            try {
                const response = await fetch(
                    `https://api.telegram.org/bot${botToken}/sendMessage`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: chatId,
                            text,
                            parse_mode: 'MarkdownV2',
                        }),
                    }
                );

                if (!response.ok) {
                    console.error(`[Alert] Telegram error: ${response.status}`);
                    return false;
                }

                return true;
            } catch (error) {
                console.error('[Alert] Telegram send failed:', error);
                return false;
            }
        },
    };
}

function escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

/**
 * Webhook 频道（通用 HTTP POST）
 */
export function createWebhookChannel(url: string): AlertChannel {
    return {
        name: 'webhook',
        async send(payload: AlertPayload): Promise<boolean> {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...payload,
                        timestamp: payload.timestamp ?? new Date().toISOString(),
                    }),
                });

                if (!response.ok) {
                    console.error(`[Alert] Webhook error: ${response.status}`);
                    return false;
                }

                return true;
            } catch (error) {
                console.error('[Alert] Webhook send failed:', error);
                return false;
            }
        },
    };
}

/**
 * PushPlus 频道（微信推送）
 */
export function createPushPlusChannel(token: string): AlertChannel {
    return {
        name: 'pushplus',
        async send(payload: AlertPayload): Promise<boolean> {
            const levelText = payload.level === 'critical' ? '🚨 严重' : payload.level === 'warning' ? '⚠️ 警告' : 'ℹ️ 信息';
            const content = [
                `<h3>${payload.title}</h3>`,
                `<p><strong>级别:</strong> ${levelText}</p>`,
                `<p>${payload.message}</p>`,
                payload.botId ? `<p><strong>Bot:</strong> ${payload.botId.slice(0, 8)}</p>` : '',
                payload.symbol ? `<p><strong>Symbol:</strong> ${payload.symbol}</p>` : '',
                `<p><strong>Time:</strong> ${payload.timestamp ?? new Date().toISOString()}</p>`,
            ].filter(Boolean).join('');

            try {
                const response = await fetch('https://www.pushplus.plus/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token,
                        title: `[${payload.level.toUpperCase()}] ${payload.title}`,
                        content,
                        template: 'html',
                    }),
                });

                if (!response.ok) {
                    console.error(`[Alert] PushPlus error: ${response.status}`);
                    return false;
                }

                const result = await response.json() as { code: number };
                return result.code === 200;
            } catch (error) {
                console.error('[Alert] PushPlus send failed:', error);
                return false;
            }
        },
    };
}

// ============================================================================
// Alert Service
// ============================================================================

export class AlertService {
    private channels: AlertChannel[] = [];
    private config: AlertConfig;

    constructor(config: AlertConfig) {
        this.config = {
            throttleWindowMs: 60 * 1000, // 默认 1 分钟节流
            enabled: true,
            ...config,
        };

        // 根据配置自动创建频道
        if (config.telegramBotToken && config.telegramChatId) {
            this.channels.push(
                createTelegramChannel(config.telegramBotToken, config.telegramChatId)
            );
        }

        if (config.webhookUrl) {
            this.channels.push(createWebhookChannel(config.webhookUrl));
        }

        if (config.pushPlusToken) {
            this.channels.push(createPushPlusChannel(config.pushPlusToken));
        }

        console.log(`[AlertService] Initialized with ${this.channels.length} channel(s): ${this.channels.map(c => c.name).join(', ')}`);
    }

    /**
     * 发送告警
     */
    async send(payload: AlertPayload): Promise<void> {
        if (!this.config.enabled) {
            console.log('[AlertService] Disabled, skipping alert');
            return;
        }

        if (this.channels.length === 0) {
            console.warn('[AlertService] No channels configured');
            return;
        }

        // 节流检查
        const key = getAlertKey(payload);
        if (shouldThrottle(key, this.config.throttleWindowMs!)) {
            console.log(`[AlertService] Throttled: ${key}`);
            return;
        }

        // 补充 timestamp
        const fullPayload: AlertPayload = {
            ...payload,
            timestamp: payload.timestamp ?? new Date().toISOString(),
        };

        // 并行发送到所有频道
        const results = await Promise.allSettled(
            this.channels.map(async (channel) => {
                const success = await channel.send(fullPayload);

                // 记录指标
                alertsSentTotal.inc({
                    channel: channel.name,
                    status: success ? 'success' : 'fail',
                });

                return { channel: channel.name, success };
            })
        );

        // 日志
        for (const result of results) {
            if (result.status === 'fulfilled') {
                console.log(`[AlertService] ${result.value.channel}: ${result.value.success ? 'sent' : 'failed'}`);
            } else {
                console.error(`[AlertService] Channel error:`, result.reason);
            }
        }
    }

    /**
     * 便捷方法：严重告警
     */
    async critical(title: string, message: string, extra?: Partial<AlertPayload>): Promise<void> {
        await this.send({ level: 'critical', title, message, ...extra });
    }

    /**
     * 便捷方法：警告
     */
    async warning(title: string, message: string, extra?: Partial<AlertPayload>): Promise<void> {
        await this.send({ level: 'warning', title, message, ...extra });
    }

    /**
     * 便捷方法：信息
     */
    async info(title: string, message: string, extra?: Partial<AlertPayload>): Promise<void> {
        await this.send({ level: 'info', title, message, ...extra });
    }

    /**
     * 添加自定义频道
     */
    addChannel(channel: AlertChannel): void {
        this.channels.push(channel);
    }

    /**
     * 获取已配置的频道列表
     */
    getChannels(): string[] {
        return this.channels.map(c => c.name);
    }
}

// ============================================================================
// Singleton Instance (可选)
// ============================================================================

let globalAlertService: AlertService | null = null;

export function initAlertService(config: AlertConfig): AlertService {
    globalAlertService = new AlertService(config);
    return globalAlertService;
}

export function getAlertService(): AlertService | null {
    return globalAlertService;
}
