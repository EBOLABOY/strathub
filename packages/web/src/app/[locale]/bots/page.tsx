
"use client";

import { Sidebar } from "@/components/Sidebar";
import { Bot as BotIcon, Plus, Pause, Play, Settings, Loader2, AlertCircle, Ban } from "lucide-react";
import clsx from 'clsx';
import { useBots } from "@/lib/hooks";
import { useRouter } from "next/navigation";
import { BotStatus } from "@crypto-strategy-hub/shared";
import { useRequireAuth } from "@/lib/useRequireAuth";

export default function BotsPage() {
    useRequireAuth();

    const router = useRouter();
    const { bots, isLoading, error } = useBots();

    return (
        <div className="flex h-screen bg-page overflow-hidden">
            <Sidebar />

            <main className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Header */}
                <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-8 sticky top-0 z-30">
                    <h1 className="text-xl font-bold text-slate-800">My Bots</h1>
                    <button
                        onClick={() => router.push('/bots/new')}
                        className="bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors shadow-lg shadow-teal-500/20"
                    >
                        <Plus className="w-4 h-4" />
                        Create Bot
                    </button>
                </header>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-8">
                    {isLoading && bots.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-slate-400">
                            <Loader2 className="w-8 h-8 animate-spin" />
                        </div>
                    ) : error ? (
                        <div className="flex items-center justify-center h-full text-rose-500 gap-2">
                            <AlertCircle className="w-6 h-6" />
                            <span>{error}</span>
                        </div>
                    ) : bots.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
                            <BotIcon className="w-12 h-12 mb-4 text-slate-300" />
                            <p className="font-medium">No bots found</p>
                            <button onClick={() => router.push('/bots/new')} className="mt-4 text-teal-600 font-semibold hover:underline">Deploy your first bot</button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {bots.map((bot) => (
                                <div
                                    key={bot.id}
                                    onClick={() => router.push(`/bots/${bot.id}`)}
                                    className="bg-white rounded-2xl shadow-diffuse border border-slate-50 p-6 hover:-translate-y-1 transition-all duration-300 group cursor-pointer relative overflow-hidden"
                                >

                                    {/* Status Indicator Line */}
                                    <div className={clsx(
                                        "absolute top-0 left-0 w-full h-1",
                                        bot.status === BotStatus.RUNNING && "bg-emerald-500",
                                        bot.status === BotStatus.PAUSED && "bg-amber-500",
                                        (bot.status === BotStatus.STOPPED) && "bg-slate-300",
                                        bot.status === BotStatus.ERROR && "bg-rose-500",
                                    )} />

                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className={clsx(
                                                "w-10 h-10 rounded-xl flex items-center justify-center border font-bold",
                                                bot.status === BotStatus.RUNNING ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                                                    bot.status === BotStatus.PAUSED ? "bg-amber-50 text-amber-600 border-amber-100" :
                                                        bot.status === BotStatus.ERROR ? "bg-rose-50 text-rose-600 border-rose-100" :
                                                            "bg-slate-50 text-slate-500 border-slate-100"
                                            )}>
                                                {bot.symbol.substring(0, 3)}
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-slate-700 text-sm">{bot.symbol}</h3>
                                                <div className="text-xs text-slate-400 font-medium flex items-center gap-1">
                                                    <BotIcon className="w-3 h-3" />
                                                    Binance {/* Placeholder for exchange name */}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="relative">
                                            <button className="p-2 text-slate-300 hover:text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
                                                <Settings className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Metrics Grid */}
                                    <div className="grid grid-cols-2 gap-4 mb-6">
                                        <div className="bg-slate-50 rounded-xl p-3">
                                            <div className="text-xs text-slate-400 font-medium mb-1">PnL (Total)</div>
                                            <div className="text-sm font-bold text-slate-400">
                                                N/A
                                            </div>
                                        </div>
                                        <div className="bg-slate-50 rounded-xl p-3">
                                            <div className="text-xs text-slate-400 font-medium mb-1">Status</div>
                                            <div className="text-sm font-bold text-slate-700 truncate">
                                                {bot.status}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Actions Footer */}
                                    <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                                        <div className={clsx(
                                            "flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full",
                                            bot.status === BotStatus.RUNNING ? "bg-emerald-50 text-emerald-600" :
                                                bot.status === BotStatus.PAUSED ? "bg-amber-50 text-amber-600" :
                                                    bot.status === BotStatus.ERROR ? "bg-rose-50 text-rose-600" :
                                                        "bg-slate-100 text-slate-500"
                                        )}>
                                            <span className={clsx(
                                                "w-1.5 h-1.5 rounded-full",
                                                bot.status === BotStatus.RUNNING ? "bg-emerald-500 animate-pulse" :
                                                    bot.status === BotStatus.PAUSED ? "bg-amber-500" :
                                                        bot.status === BotStatus.ERROR ? "bg-rose-500" :
                                                            "bg-slate-400"
                                            )} />
                                            {bot.status}
                                        </div>

                                        {/* Quick indicator, no action here to avoid accidental click */}
                                        <div className="text-slate-300">
                                            {bot.status === BotStatus.RUNNING ? <Play className="w-4 h-4 fill-current opacity-50" /> :
                                                bot.status === BotStatus.PAUSED ? <Pause className="w-4 h-4 fill-current opacity-50" /> :
                                                    <Ban className="w-4 h-4" />}
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* New Bot Card Placeholder */}
                            <div
                                onClick={() => router.push('/bots/new')}
                                className="border-2 border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center text-slate-400 hover:border-teal-300 hover:text-teal-500 hover:bg-teal-50/10 cursor-pointer transition-all min-h-[220px] group"
                            >
                                <div className="w-12 h-12 rounded-full bg-slate-50 group-hover:bg-white flex items-center justify-center mb-3 transition-colors shadow-sm">
                                    <Plus className="w-6 h-6" />
                                </div>
                                <span className="font-semibold text-sm">Deploy New Strategy</span>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
