
import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from './api';
import { Bot, BotStatus } from '@crypto-strategy-hub/shared';
import { useTranslations } from "next-intl";

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
    const [runtime, setRuntime] = useState<BotRuntime | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pollingEnabled, setPollingEnabled] = useState(true);

    const fetchBot = useCallback(async () => {
        if (!id || !pollingEnabled) return;

        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            setIsLoading(false);
            if (!bot) setError(t("authRequired"));
            setPollingEnabled(false);
            return;
        }

        try {
            const [botData, runtimeData] = await Promise.all([
                api.bots.get(id),
                api.bots.getRuntime(id)
            ]);
            setBot(botData);
            setRuntime(runtimeData);
            setError(null);
        } catch (err: any) {
            if (!bot) {
                if (err instanceof ApiError) {
                    if (err.code && tApiErrors.has(err.code as any)) {
                        setError(tApiErrors(err.code as any));
                        if (err.code === 'BOT_NOT_FOUND' || err.code === 'INVALID_TOKEN' || err.code === 'UNAUTHORIZED') {
                            setPollingEnabled(false);
                        }
                        return;
                    }
                    if (err.status === 401) {
                        setError(t("authRequired"));
                        setPollingEnabled(false);
                        return;
                    }
                }
                setError(t("fetchBotDetails"));
            }
        } finally {
            setIsLoading(false);
        }
    }, [id, bot, pollingEnabled, t, tApiErrors]);

    useEffect(() => {
        if (!pollingEnabled) return;
        fetchBot();
        const timer = setInterval(fetchBot, interval);
        return () => clearInterval(timer);
    }, [fetchBot, interval, pollingEnabled]);

    return { bot, runtime, isLoading, error, refresh: fetchBot };
}
