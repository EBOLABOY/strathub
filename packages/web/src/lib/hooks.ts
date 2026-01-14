
import { useState, useEffect, useCallback, useRef } from 'react';
import { api, ApiError } from './api';
import { Bot, BotStatus } from '@crypto-strategy-hub/shared';
import { useTranslations } from "next-intl";

function runtimePollBaseMs(status: BotStatus | string | undefined, activeIntervalMs: number): number {
    const safeActive = Number.isFinite(activeIntervalMs) && activeIntervalMs > 0 ? activeIntervalMs : 2000;

    switch (status) {
        case BotStatus.RUNNING:
            return safeActive;
        case BotStatus.STOPPING:
            return Math.min(1000, safeActive);
        case BotStatus.WAITING_TRIGGER:
            return Math.max(3000, safeActive);
        case BotStatus.PAUSED:
        case BotStatus.STOPPED:
        case BotStatus.DRAFT:
        case BotStatus.ERROR:
            return Math.max(10_000, safeActive);
        default:
            return Math.max(5000, safeActive);
    }
}

function withBackoffMs(baseMs: number, failureCount: number): number {
    const safeBase = Math.max(250, Math.floor(baseMs));
    const safeFailures = Number.isFinite(failureCount) && failureCount > 0 ? Math.floor(failureCount) : 0;
    if (safeFailures === 0) return safeBase;

    const cappedFailures = Math.min(safeFailures, 5);
    const maxMs = 30_000;
    const backoff = safeBase * Math.pow(2, cappedFailures);
    return Math.min(maxMs, Math.floor(backoff));
}

export function useBots(interval = 5000) {
    const t = useTranslations("errors");
    const tApiErrors = useTranslations("apiErrors");

    const [bots, setBots] = useState<Bot[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchBots = useCallback(async () => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            setIsLoading(false);
            if (bots.length === 0) {
                setError(t("authRequired"));
            }
            return;
        }

        try {
            const data = await api.bots.list();
            setBots(data);
            setError(null);
        } catch (err: any) {
            // Don't set error on poll failure to avoid flashing if it's transient
            // Only set if we have no data
            if (bots.length === 0) {
                if (err instanceof ApiError) {
                    if (err.code && tApiErrors.has(err.code as any)) {
                        setError(tApiErrors(err.code as any));
                        return;
                    }
                    if (err.status === 401) {
                        setError(t("authRequired"));
                        return;
                    }
                }
                setError(t("fetchBots"));
            }
        } finally {
            setIsLoading(false);
        }
    }, [bots.length, t, tApiErrors]);

    useEffect(() => {
        fetchBots();
        const id = setInterval(fetchBots, interval);
        return () => clearInterval(id);
    }, [fetchBots, interval]);

    return { bots, isLoading, error, refresh: fetchBots };
}

export interface BotRuntime {
    status: BotStatus;
    statusVersion: number;
    runId: string | null;
    lastError: string | null;
    snapshot: any;
}

export function useBot(id: string, interval = 2000) {
    const t = useTranslations("errors");
    const tApiErrors = useTranslations("apiErrors");

    const [bot, setBot] = useState<Bot | null>(null);
    const botRef = useRef<Bot | null>(null);
    const [runtime, setRuntime] = useState<BotRuntime | null>(null);
    const runtimeRef = useRef<BotRuntime | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pollingEnabled, setPollingEnabled] = useState(true);

    const pollTimerRef = useRef<number | null>(null);
    const pollInFlightRef = useRef(false);
    const pollFailureCountRef = useRef(0);
    const sessionRef = useRef(0);
    const botRequestSeqRef = useRef(0);
    const runtimeRequestSeqRef = useRef(0);

    const clearPollTimer = useCallback(() => {
        if (pollTimerRef.current !== null) {
            clearTimeout(pollTimerRef.current);
            pollTimerRef.current = null;
        }
    }, []);

    const disablePolling = useCallback(() => {
        clearPollTimer();
        setPollingEnabled(false);
    }, [clearPollTimer]);

    const ensureAuthOrDisable = useCallback((): string | null => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            setIsLoading(false);
            if (!botRef.current) setError(t("authRequired"));
            disablePolling();
            return null;
        }
        return token;
    }, [disablePolling, t]);

    const fetchBotOnce = useCallback(async () => {
        if (!id || !pollingEnabled) return;
        if (!ensureAuthOrDisable()) return;

        const session = sessionRef.current;
        const seq = ++botRequestSeqRef.current;

        try {
            const botData = await api.bots.get(id);
            if (session !== sessionRef.current || seq !== botRequestSeqRef.current) return;

            botRef.current = botData;
            setBot(botData);
            setError(null);
        } catch (err: any) {
            if (session !== sessionRef.current || seq !== botRequestSeqRef.current) return;

            if (err instanceof ApiError) {
                if (err.code === 'BOT_NOT_FOUND' || err.code === 'INVALID_TOKEN' || err.code === 'UNAUTHORIZED') {
                    if (err.code && tApiErrors.has(err.code as any)) {
                        setError(tApiErrors(err.code as any));
                    } else if (err.status === 401) {
                        setError(t("authRequired"));
                    } else {
                        setError(t("fetchBotDetails"));
                    }
                    disablePolling();
                    return;
                }

                if (!botRef.current && err.code && tApiErrors.has(err.code as any)) {
                    setError(tApiErrors(err.code as any));
                    return;
                }

                if (!botRef.current && err.status === 401) {
                    setError(t("authRequired"));
                    disablePolling();
                    return;
                }
            }

            if (!botRef.current) {
                setError(t("fetchBotDetails"));
            }
        } finally {
            if (session === sessionRef.current && seq === botRequestSeqRef.current) {
                setIsLoading(false);
            }
        }
    }, [disablePolling, ensureAuthOrDisable, id, pollingEnabled, t, tApiErrors]);

    const syncBotRuntimeFields = useCallback((nextRuntime: BotRuntime) => {
        if (!botRef.current) return;

        const current = botRef.current;
        const needsUpdate =
            current.status !== nextRuntime.status ||
            current.statusVersion !== nextRuntime.statusVersion ||
            current.runId !== nextRuntime.runId ||
            current.lastError !== nextRuntime.lastError;

        if (!needsUpdate) return;

        const updated: Bot = {
            ...current,
            status: nextRuntime.status,
            statusVersion: nextRuntime.statusVersion,
            runId: nextRuntime.runId,
            lastError: nextRuntime.lastError,
        };

        botRef.current = updated;
        setBot(updated);
    }, []);

    const fetchRuntimeOnce = useCallback(async () => {
        if (!id || !pollingEnabled) return;
        if (!ensureAuthOrDisable()) return;

        const session = sessionRef.current;
        const seq = ++runtimeRequestSeqRef.current;
        pollInFlightRef.current = true;

        try {
            const runtimeData = await api.bots.getRuntime(id);
            if (session !== sessionRef.current || seq !== runtimeRequestSeqRef.current) return;

            pollFailureCountRef.current = 0;
            runtimeRef.current = runtimeData;
            setRuntime(runtimeData);
            syncBotRuntimeFields(runtimeData);
        } catch (err: any) {
            if (session !== sessionRef.current || seq !== runtimeRequestSeqRef.current) return;

            pollFailureCountRef.current += 1;

            if (err instanceof ApiError) {
                if (err.code === 'BOT_NOT_FOUND' || err.code === 'INVALID_TOKEN' || err.code === 'UNAUTHORIZED') {
                    if (err.code && tApiErrors.has(err.code as any)) {
                        setError(tApiErrors(err.code as any));
                    } else if (err.status === 401) {
                        setError(t("authRequired"));
                    } else {
                        setError(t("fetchBotDetails"));
                    }
                    disablePolling();
                    return;
                }
            }

            // Transient runtime poll failure: keep UI stable if we already have bot data.
            if (!botRef.current && !runtimeRef.current) {
                setError(t("fetchBotDetails"));
            }
        } finally {
            pollInFlightRef.current = false;
            if (session === sessionRef.current && seq === runtimeRequestSeqRef.current) {
                setIsLoading(false);
            }
        }
    }, [disablePolling, ensureAuthOrDisable, id, pollingEnabled, syncBotRuntimeFields, t, tApiErrors]);

    const refresh = useCallback(async () => {
        if (!id) return;
        await Promise.all([fetchBotOnce(), fetchRuntimeOnce()]);
    }, [fetchBotOnce, fetchRuntimeOnce, id]);

    useEffect(() => {
        // Reset per-bot state
        sessionRef.current += 1; // invalidate in-flight
        botRequestSeqRef.current = 0;
        runtimeRequestSeqRef.current = 0;
        pollFailureCountRef.current = 0;
        pollInFlightRef.current = false;
        clearPollTimer();

        botRef.current = null;
        runtimeRef.current = null;
        setBot(null);
        setRuntime(null);
        setError(null);
        setIsLoading(true);
        setPollingEnabled(true);
    }, [clearPollTimer, id]);

    useEffect(() => {
        if (!id || !pollingEnabled) return;

        // 1) Static bot details: fetch once
        void fetchBotOnce();

        // 2) Runtime: dynamic polling with backoff + visibility pause
        let disposed = false;

        const scheduleNext = (overrideDelayMs?: number) => {
            if (disposed) return;
            clearPollTimer();

            const status = runtimeRef.current?.status ?? botRef.current?.status;
            const baseMs = runtimePollBaseMs(status, interval);
            const delayMs =
                typeof overrideDelayMs === 'number'
                    ? Math.max(0, Math.floor(overrideDelayMs))
                    : withBackoffMs(baseMs, pollFailureCountRef.current);

            pollTimerRef.current = window.setTimeout(() => void tick(), delayMs);
        };

        const tick = async () => {
            if (disposed) return;

            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                // Don’t hammer the network when tab is hidden.
                scheduleNext(Math.max(10_000, interval));
                return;
            }

            if (pollInFlightRef.current) {
                scheduleNext(Math.min(250, interval));
                return;
            }

            await fetchRuntimeOnce();
            scheduleNext();
        };

        const onVisibilityChange = () => {
            if (disposed) return;
            if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
                scheduleNext(0);
            }
        };

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibilityChange);
        }

        scheduleNext(0);

        return () => {
            disposed = true;
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisibilityChange);
            }
            clearPollTimer();
        };
    }, [clearPollTimer, fetchBotOnce, fetchRuntimeOnce, id, interval, pollingEnabled]);

    return { bot, runtime, isLoading, error, refresh };
}
