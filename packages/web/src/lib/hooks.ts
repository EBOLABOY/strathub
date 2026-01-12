
import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from './api';
import { Bot, BotStatus } from '@crypto-strategy-hub/shared';

export function useBots(interval = 5000) {
    const [bots, setBots] = useState<Bot[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchBots = useCallback(async () => {
        try {
            const data = await api.bots.list();
            setBots(data);
            setError(null);
        } catch (err: any) {
            console.error(err);
            // Don't set error on poll failure to avoid flashing if it's transient
            // Only set if we have no data
            if (bots.length === 0) {
                setError(err.message || 'Failed to fetch bots');
            }
        } finally {
            setIsLoading(false);
        }
    }, [bots.length]);

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
    const [bot, setBot] = useState<Bot | null>(null);
    const [runtime, setRuntime] = useState<BotRuntime | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchBot = useCallback(async () => {
        if (!id) return;
        try {
            const [botData, runtimeData] = await Promise.all([
                api.bots.get(id),
                api.bots.getRuntime(id)
            ]);
            setBot(botData);
            setRuntime(runtimeData);
            setError(null);
        } catch (err: any) {
            console.error(err);
            if (!bot) setError(err.message || 'Failed to fetch bot details');
        } finally {
            setIsLoading(false);
        }
    }, [id, bot]);

    useEffect(() => {
        fetchBot();
        const timer = setInterval(fetchBot, interval);
        return () => clearInterval(timer);
    }, [fetchBot, interval]);

    return { bot, runtime, isLoading, error, refresh: fetchBot };
}
