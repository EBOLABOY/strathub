"use client";

import { Sidebar } from "@/components/Sidebar";
import { Bot as BotIcon, Plus, Loader2, AlertCircle } from "lucide-react";
import { useBots } from "@/lib/hooks";
import { useRouter } from "@/i18n/navigation";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { useTranslations } from "next-intl";
import { BotCard } from "@/components/BotCard";

export default function BotsPage() {
    useRequireAuth();

    const router = useRouter();
    const { bots, isLoading, error } = useBots();
    const t = useTranslations("bots");

    return (
        <div className="flex h-screen bg-page overflow-hidden">
            <Sidebar />

            <main className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Header */}
                <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-8 sticky top-0 z-40">
                    <h1 className="text-xl font-bold text-slate-800">{t("title")}</h1>
                    <button
                        onClick={() => router.push('/bots/new')}
                        className="bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors shadow-lg shadow-teal-500/20"
                    >
                        <Plus className="w-4 h-4" />
                        {t("create")}
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
                            <p className="font-medium">{t("emptyTitle")}</p>
                            <button onClick={() => router.push('/bots/new')} className="mt-4 text-teal-600 font-semibold hover:underline">{t("emptyCta")}</button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {bots.map((bot) => (
                                <BotCard
                                    key={bot.id}
                                    bot={bot}
                                    onClick={() => router.push(`/bots/${bot.id}`)}
                                />
                            ))}

                            {/* New Bot Card Placeholder */}
                            <div
                                onClick={() => router.push('/bots/new')}
                                className="border-2 border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center text-slate-400 hover:border-teal-300 hover:text-teal-500 hover:bg-teal-50/10 cursor-pointer transition-all min-h-[200px] group"
                            >
                                <div className="w-12 h-12 rounded-full bg-slate-50 group-hover:bg-white flex items-center justify-center mb-3 transition-colors shadow-sm">
                                    <Plus className="w-6 h-6" />
                                </div>
                                <span className="font-semibold text-sm">{t("newCard")}</span>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
