"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from "next-intl";
import { api, DashboardStats } from '@/lib/api';
import { Bot, BotStatus } from '@crypto-strategy-hub/shared';
import clsx from 'clsx';
import Link from 'next/link';

// Status badge style mapping
const statusStyles: Record<string, { bg: string; text: string; dot: string }> = {
    [BotStatus.RUNNING]: { bg: 'bg-emerald-50', text: 'text-emerald-600', dot: 'bg-emerald-500' },
    [BotStatus.WAITING_TRIGGER]: { bg: 'bg-amber-50', text: 'text-amber-600', dot: 'bg-amber-500' },
    [BotStatus.PAUSED]: { bg: 'bg-slate-50', text: 'text-slate-600', dot: 'bg-slate-400' },
    [BotStatus.STOPPED]: { bg: 'bg-slate-50', text: 'text-slate-500', dot: 'bg-slate-400' },
    [BotStatus.STOPPING]: { bg: 'bg-orange-50', text: 'text-orange-600', dot: 'bg-orange-500' },
    [BotStatus.ERROR]: { bg: 'bg-rose-50', text: 'text-rose-600', dot: 'bg-rose-500' },
    [BotStatus.DRAFT]: { bg: 'bg-slate-50', text: 'text-slate-400', dot: 'bg-slate-300' },
};

function getStatusStyle(status: string) {
    return statusStyles[status] || statusStyles[BotStatus.DRAFT];
}

export function ActiveBotsList() {
    const t = useTranslations("dashboard");
    const tStatus = useTranslations("botStatus");

    const [bots, setBots] = useState<Bot[]>([]);
    const [pnl24h, setPnl24h] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadBots = async () => {
            try {
                setLoading(true);

                // Fetch bots and dashboard stats in parallel
                const [allBots, dashboardStats] = await Promise.all([
                    api.bots.list(),
                    api.dashboard.getStats()
                ]);

                // Sort by status priority: RUNNING > WAITING_TRIGGER > PAUSED > others
                const statusPriority: Record<string, number> = {
                    [BotStatus.RUNNING]: 0,
                    [BotStatus.WAITING_TRIGGER]: 1,
                    [BotStatus.PAUSED]: 2,
                    [BotStatus.STOPPING]: 3,
                    [BotStatus.ERROR]: 4,
                    [BotStatus.STOPPED]: 5,
                    [BotStatus.DRAFT]: 6,
                };
                allBots.sort((a, b) => {
                    const pa = statusPriority[a.status] ?? 99;
                    const pb = statusPriority[b.status] ?? 99;
                    return pa - pb;
                });

                // Show top 5 bots on dashboard
                setBots(allBots.slice(0, 5));
                setPnl24h(dashboardStats.pnl24h || {});
                setError(null);
            } catch (err) {
                console.error("Failed to load bots:", err);
                setError(err instanceof Error ? err.message : 'Failed to load bots');
            } finally {
                setLoading(false);
            }
        };

        loadBots();
    }, []);

    if (loading) {
        return (
            <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="animate-pulse grid grid-cols-5 items-center py-4 px-2">
                        <div className="col-span-2 flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-slate-200"></div>
                            <div className="space-y-2">
                                <div className="h-4 w-24 bg-slate-200 rounded"></div>
                                <div className="h-3 w-16 bg-slate-100 rounded"></div>
                            </div>
                        </div>
                        <div className="h-6 w-16 bg-slate-200 rounded-full"></div>
                        <div className="h-4 w-16 bg-slate-200 rounded"></div>
                        <div className="h-8 w-16 bg-slate-200 rounded-lg ml-auto"></div>
                    </div>
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-8">
                <p className="text-rose-500 text-sm">{error}</p>
                <button
                    onClick={() => window.location.reload()}
                    className="mt-2 text-sm text-teal-600 hover:text-teal-700"
                >
                    {t("retry")}
                </button>
            </div>
        );
    }

    if (bots.length === 0) {
        return (
            <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-50 flex items-center justify-center">
                    <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                </div>
                <p className="text-slate-500 text-sm mb-3">{t("noBotsYet")}</p>
                <Link
                    href="/bots/new"
                    className="inline-flex items-center gap-2 text-sm font-medium text-teal-600 hover:text-teal-700"
                >
                    <span>+</span>
                    {t("createFirstBot")}
                </Link>
            </div>
        );
    }

    return (
        <div className="space-y-1">
            {bots.map((bot, index) => {
                const style = getStatusStyle(bot.status);
                const botPnl = pnl24h[bot.id];
                const hasPnl = botPnl !== undefined;
                const isPnlPositive = hasPnl && botPnl >= 0;

                return (
                    <div
                        key={bot.id}
                        className="grid grid-cols-5 items-center py-4 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 px-2 rounded-lg transition-colors"
                    >
                        <div className="col-span-2 flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center text-teal-600 font-bold text-xs border border-teal-100">
                                B{index + 1}
                            </div>
                            <div>
                                <div className="font-semibold text-slate-700 text-sm">
                                    {bot.symbol}
                                </div>
                                <div className="text-xs text-slate-400">
                                    {t("exchangeLimit")}
                                </div>
                            </div>
                        </div>
                        <div>
                            <span className={clsx(
                                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
                                style.bg,
                                style.text,
                                `border-${style.text.replace('text-', '')}/20`
                            )}>
                                <span className={clsx("w-1.5 h-1.5 rounded-full", style.dot)}></span>
                                {tStatus(bot.status)}
                            </span>
                        </div>
                        <div className={clsx(
                            "text-sm font-semibold",
                            !hasPnl ? "text-slate-400" :
                                isPnlPositive ? "text-emerald-600" : "text-rose-600"
                        )}>
                            {hasPnl ? (
                                <>
                                    {isPnlPositive ? '+' : ''}
                                    ${botPnl.toFixed(2)}
                                </>
                            ) : (
                                '--'
                            )}
                        </div>
                        <div className="text-right">
                            <Link
                                href={`/bots/${bot.id}`}
                                className="text-xs font-medium text-slate-500 hover:text-slate-800 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm hover:shadow-md transition-all"
                            >
                                {t("manage")}
                            </Link>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
