"use client";

/**
 * useSSE - Server-Sent Events Hook
 * 
 * 用于实时接收服务器推送的状态更新，替代轮询机制
 * 
 * 特性：
 * - 自动重连（带指数退避）
 * - 连接状态管理
 * - 类型安全的事件处理
 * - 页面可见性感知（隐藏时断开连接节省资源）
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export type SSEStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface SSEEvent<T = unknown> {
    type: string;
    data: T;
    timestamp: string;
}

export interface BotStatusEvent {
    botId: string;
    status: string;
    statusVersion: number;
    runId: string | null;
    lastError: string | null;
}

export interface BotLogEvent {
    botId: string;
    runId: string;
    level: string;
    message: string;
    timestamp: string;
}

export interface UseSSEOptions {
    /** 订阅的事件类型 */
    topics?: string[];
    /** 是否自动重连 */
    autoReconnect?: boolean;
    /** 重连间隔基数（毫秒） */
    reconnectInterval?: number;
    /** 最大重连间隔（毫秒） */
    maxReconnectInterval?: number;
    /** 是否在页面隐藏时断开 */
    disconnectOnHidden?: boolean;
}

export interface UseSSEResult {
    status: SSEStatus;
    lastEvent: SSEEvent | null;
    botStatuses: Map<string, BotStatusEvent>;
    connect: () => void;
    disconnect: () => void;
}

const DEFAULT_OPTIONS: Required<UseSSEOptions> = {
    topics: ['botStatus', 'botLog'],
    autoReconnect: true,
    reconnectInterval: 1000,
    maxReconnectInterval: 30000,
    disconnectOnHidden: true,
};

export function useSSE(options: UseSSEOptions = {}): UseSSEResult {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    const [status, setStatus] = useState<SSEStatus>('disconnected');
    const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
    const [botStatuses, setBotStatuses] = useState<Map<string, BotStatusEvent>>(new Map());

    const eventSourceRef = useRef<EventSource | null>(null);
    const reconnectAttemptRef = useRef(0);
    const reconnectTimeoutRef = useRef<number | null>(null);
    const manualDisconnectRef = useRef(false);

    const clearReconnectTimeout = useCallback(() => {
        if (reconnectTimeoutRef.current !== null) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
    }, []);

    const disconnect = useCallback(() => {
        manualDisconnectRef.current = true;
        clearReconnectTimeout();

        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }

        setStatus('disconnected');
    }, [clearReconnectTimeout]);

    const connect = useCallback(() => {
        // 检查 token
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            setStatus('error');
            return;
        }

        // 关闭现有连接
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        manualDisconnectRef.current = false;
        setStatus('connecting');

        // 构建 SSE URL
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
        const topicsParam = opts.topics.join(',');
        const url = `${baseUrl}/sse?topics=${topicsParam}&token=${token}`;

        try {
            const es = new EventSource(url);
            eventSourceRef.current = es;

            es.onopen = () => {
                setStatus('connected');
                reconnectAttemptRef.current = 0;
                console.log('[SSE] Connected');
            };

            es.onmessage = (event) => {
                try {
                    const parsed = JSON.parse(event.data) as SSEEvent;
                    setLastEvent(parsed);

                    // 处理 botStatus 事件
                    if (parsed.type === 'botStatus') {
                        const botStatus = parsed.data as BotStatusEvent;
                        setBotStatuses(prev => {
                            const next = new Map(prev);
                            next.set(botStatus.botId, botStatus);
                            return next;
                        });
                    }
                } catch (err) {
                    console.warn('[SSE] Failed to parse event:', err);
                }
            };

            es.onerror = (error) => {
                console.error('[SSE] Error:', error);
                es.close();
                eventSourceRef.current = null;
                setStatus('error');

                // 自动重连
                if (opts.autoReconnect && !manualDisconnectRef.current) {
                    reconnectAttemptRef.current += 1;
                    const delay = Math.min(
                        opts.reconnectInterval * Math.pow(2, reconnectAttemptRef.current - 1),
                        opts.maxReconnectInterval
                    );

                    console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current})`);

                    reconnectTimeoutRef.current = window.setTimeout(() => {
                        if (!manualDisconnectRef.current) {
                            connect();
                        }
                    }, delay);
                }
            };
        } catch (err) {
            console.error('[SSE] Failed to create EventSource:', err);
            setStatus('error');
        }
    }, [opts.topics, opts.autoReconnect, opts.reconnectInterval, opts.maxReconnectInterval]);

    // 页面可见性处理
    useEffect(() => {
        if (!opts.disconnectOnHidden) return;

        const handleVisibilityChange = () => {
            if (typeof document === 'undefined') return;

            if (document.visibilityState === 'hidden') {
                // 页面隐藏时断开连接
                if (eventSourceRef.current) {
                    console.log('[SSE] Page hidden, disconnecting');
                    eventSourceRef.current.close();
                    eventSourceRef.current = null;
                    setStatus('disconnected');
                }
            } else if (document.visibilityState === 'visible') {
                // 页面可见时重新连接
                if (!eventSourceRef.current && !manualDisconnectRef.current) {
                    console.log('[SSE] Page visible, reconnecting');
                    connect();
                }
            }
        };

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityChange);
        }

        return () => {
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
            }
        };
    }, [opts.disconnectOnHidden, connect]);

    // 组件卸载时清理
    useEffect(() => {
        return () => {
            clearReconnectTimeout();
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
        };
    }, [clearReconnectTimeout]);

    return {
        status,
        lastEvent,
        botStatuses,
        connect,
        disconnect,
    };
}

/**
 * useBotSSE - 针对单个 Bot 的 SSE Hook
 * 
 * 自动订阅指定 botId 的状态更新
 */
export function useBotSSE(botId: string) {
    const { status, botStatuses, connect, disconnect } = useSSE({
        topics: ['botStatus'],
    });

    const botStatus = botStatuses.get(botId) || null;
    const hasConnectedRef = useRef(false);

    // 只在首次挂载时连接，避免 React Strict Mode 导致的重复连接
    useEffect(() => {
        if (!hasConnectedRef.current) {
            hasConnectedRef.current = true;
            connect();
        }
        return () => {
            // 不在这里断开，让 useSSE 的清理函数处理
        };
    }, []); // 空依赖，只在挂载时执行一次

    return {
        status,
        botStatus,
        isConnected: status === 'connected',
    };
}
