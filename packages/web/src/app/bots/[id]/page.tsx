
"use client";

import { Sidebar } from "@/components/Sidebar";
import { useBot } from "@/lib/hooks";
import { useParams, useRouter } from "next/navigation";
import {
    Bot, ArrowLeft, Play, Pause, Square,
    Activity, Clock, AlertTriangle, Loader2, Eye, ShieldCheck, XCircle, CheckCircle
} from "lucide-react";
import clsx from 'clsx';
import { BotStatus } from "@crypto-strategy-hub/shared";
import { api } from "@/lib/api";
import { useState } from "react";

export default function BotDetailPage() {
    const params = useParams();
    const router = useRouter();
    const id = params?.id as string;
    const { bot, runtime, isLoading, error, refresh } = useBot(id);

    // Action State
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    // Preview State
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewResult, setPreviewResult] = useState<any>(null);
    const [showPreview, setShowPreview] = useState(false);

    const handleAction = async (action: 'start' | 'stop' | 'pause' | 'resume') => {
        setActionLoading(action);
        setActionError(null);
        try {
            await api.bots.control(id, action);
            refresh(); // Poll immediately
        } catch (err: any) {
            setActionError(err.message || `Failed to ${action} bot`);
        } finally {
            setActionLoading(null);
        }
    };

    const handlePreview = async () => {
        setPreviewLoading(true);
        setPreviewResult(null);
        setActionError(null);
        try {
            const res = await api.bots.preview(id);
            setPreviewResult(res);
            setShowPreview(true);
        } catch (err: any) {
            setActionError(err.message || "Failed to preview bot");
        } finally {
            setPreviewLoading(false);
        }
    };

    if (isLoading && !bot) {
        return (
            <div className="flex h-screen bg-page items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
            </div>
        );
    }

    if (error || !bot) {
        return (
            <div className="flex h-screen bg-page items-center justify-center flex-col gap-4">
                <div className="text-rose-500 flex items-center gap-2">
                    <AlertTriangle className="w-6 h-6" />
                    <span>{error || 'Bot not found'}</span>
                </div>
                <button onClick={() => router.push('/bots')} className="text-slate-500 hover:underline">
                    Back to List
                </button>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-page overflow-hidden">
            <Sidebar />

            <main className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Header */}
                <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 px-8 py-4 flex items-center justify-between sticky top-0 z-30">
                    <div className="flex items-center gap-4">
                        <button onClick={() => router.push('/bots')} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-slate-500">
                                <Bot className="w-5 h-5" />
                            </div>
                            <div>
                                <h1 className="text-lg font-bold text-slate-800">{bot.symbol}</h1>
                                <div className="text-xs text-slate-400 font-mono">ID: {bot.id.slice(0, 8)}</div>
                            </div>
                        </div>

                        {/* Status Badge */}
                        <div className={clsx(
                            "ml-4 px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-2",
                            bot.status === BotStatus.RUNNING ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                                bot.status === BotStatus.PAUSED ? "bg-amber-50 text-amber-600 border-amber-100" :
                                    bot.status === BotStatus.ERROR ? "bg-rose-50 text-rose-600 border-rose-100" :
                                        "bg-slate-100 text-slate-500 border-slate-200"
                        )}>
                            <span className={clsx(
                                "w-2 h-2 rounded-full",
                                bot.status === BotStatus.RUNNING ? "bg-emerald-500 animate-pulse" :
                                    bot.status === BotStatus.PAUSED ? "bg-amber-500" :
                                        bot.status === BotStatus.ERROR ? "bg-rose-500" :
                                            "bg-slate-400"
                            )} />
                            {bot.status}
                        </div>
                    </div>

                    {/* Actions Toolbar */}
                    <div className="flex items-center gap-2">
                        {actionError && (
                            <div className="text-xs text-rose-500 font-medium mr-4 flex items-center gap-1 bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-100 animate-fade-in">
                                <AlertTriangle className="w-3 h-3" />
                                {actionError}
                            </div>
                        )}

                        {/* Preview (Only for STOPPED/DRAFT) */}
                        {(bot.status === BotStatus.DRAFT || bot.status === BotStatus.STOPPED) && (
                            <button
                                onClick={handlePreview}
                                disabled={previewLoading || !!actionLoading}
                                className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 py-2 rounded-lg text-sm font-bold shadow-sm disabled:opacity-50 transition-all mr-2"
                            >
                                {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                                Preview
                            </button>
                        )}

                        {/* Start */}
                        {(bot.status === BotStatus.DRAFT || bot.status === BotStatus.STOPPED) && (
                            <button
                                onClick={() => handleAction('start')}
                                disabled={!!actionLoading || previewLoading}
                                className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition-all"
                            >
                                {actionLoading === 'start' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                Start
                            </button>
                        )}

                        {/* Pause */}
                        {bot.status === BotStatus.RUNNING && (
                            <button
                                onClick={() => handleAction('pause')}
                                disabled={!!actionLoading}
                                className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-amber-500/20 disabled:opacity-50 transition-all"
                            >
                                {actionLoading === 'pause' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
                                Pause
                            </button>
                        )}

                        {/* Resume */}
                        {bot.status === BotStatus.PAUSED && (
                            <button
                                onClick={() => handleAction('resume')}
                                disabled={!!actionLoading}
                                className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition-all"
                            >
                                {actionLoading === 'resume' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                Resume
                            </button>
                        )}

                        {/* Stop */}
                        {(bot.status === BotStatus.RUNNING || bot.status === BotStatus.PAUSED || bot.status === BotStatus.ERROR) && (
                            <button
                                onClick={() => handleAction('stop')}
                                disabled={!!actionLoading}
                                className="flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-rose-500/20 disabled:opacity-50 transition-all"
                            >
                                {actionLoading === 'stop' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4 fill-current" />}
                                Stop
                            </button>
                        )}
                    </div>
                </header>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-8 space-y-6">

                    {/* Preview Panel */}
                    {showPreview && previewResult && (
                        <section className="bg-white rounded-2xl shadow-diffuse border border-teal-100 overflow-hidden ring-4 ring-teal-50/50 animate-in slide-in-from-top-4 duration-300">
                            <div className="p-4 bg-teal-50 border-b border-teal-100 flex items-center justify-between">
                                <div className="flex items-center gap-2 text-teal-800 font-bold">
                                    <ShieldCheck className="w-5 h-5 text-teal-600" />
                                    Risk Analysis & Preview
                                </div>
                                <button onClick={() => setShowPreview(false)} className="text-teal-600 hover:text-teal-800">
                                    <XCircle className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    {/* Validations */}
                                    <div>
                                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Health Check</h4>
                                        <div className="space-y-2">
                                            {previewResult.issues && previewResult.issues.length > 0 ? (
                                                previewResult.issues.map((issue: any, i: number) => (
                                                    <div key={i} className={clsx(
                                                        "flex items-start gap-2 text-sm p-3 rounded-lg border",
                                                        issue.severity === 'ERROR' ? "bg-rose-50 text-rose-700 border-rose-100" :
                                                            issue.severity === 'WARNING' ? "bg-amber-50 text-amber-700 border-amber-100" :
                                                                "bg-slate-50 text-slate-700 border-slate-200"
                                                    )}>
                                                        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                                        <span>{issue.message}</span>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-3 py-2 rounded-lg text-sm">
                                                    <CheckCircle className="w-4 h-4" />
                                                    Configuration valid. No risks detected.
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Estimates */}
                                    <div>
                                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Estimates</h4>
                                        <div className="bg-slate-50 rounded-xl p-4 text-sm space-y-2">
                                            <div className="flex justify-between">
                                                <span className="text-slate-500">Spread</span>
                                                <span className="font-mono font-bold text-slate-700">{previewResult.estimates?.spreadPercent || '0'}%</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-500">Est. Fee (Roundtrip)</span>
                                                <span className="font-mono font-bold text-slate-700">{previewResult.estimates?.estimatedFeeQuoteRoundTrip || '0'}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-500">Est. Net Profit</span>
                                                <span className={clsx("font-mono font-bold", parseFloat(previewResult.estimates?.estimatedNetProfitQuoteRoundTrip || '0') >= 0 ? "text-emerald-600" : "text-rose-600")}>
                                                    {previewResult.estimates?.estimatedNetProfitQuoteRoundTrip || '0'}
                                                </span>
                                            </div>
                                            <div className="pt-2 border-t border-slate-200 mt-2">
                                                <div className="flex justify-between">
                                                    <span className="text-slate-500">Order Count</span>
                                                    <span className="font-mono font-bold text-slate-700">{previewResult.orders?.length || 0}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Runtime Stats */}
                    <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-white p-6 rounded-2xl shadow-diffuse border border-slate-50">
                            <div className="flex items-center gap-2 mb-2 text-slate-400 text-sm font-medium">
                                <Activity className="w-4 h-4" />
                                Run ID
                            </div>
                            <div className="text-lg font-mono font-bold text-slate-700 truncate">
                                {runtime?.runId ? runtime.runId.slice(0, 8) : 'N/A'}
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-2xl shadow-diffuse border border-slate-50">
                            <div className="flex items-center gap-2 mb-2 text-slate-400 text-sm font-medium">
                                <Clock className="w-4 h-4" />
                                Status Version
                            </div>
                            <div className="text-lg font-mono font-bold text-slate-700">
                                v{runtime?.statusVersion ?? 0}
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-2xl shadow-diffuse border border-slate-50">
                            <div className="flex items-center gap-2 mb-2 text-slate-400 text-sm font-medium">
                                <AlertTriangle className="w-4 h-4" />
                                Last Error
                            </div>
                            <div className="text-sm font-medium text-rose-500 line-clamp-2">
                                {runtime?.lastError || 'None'}
                            </div>
                        </div>
                    </section>

                    {/* Config Preview */}
                    <section className="bg-white rounded-2xl shadow-diffuse border border-slate-50 overflow-hidden">
                        <div className="p-4 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between">
                            <h3 className="font-bold text-slate-700 text-sm">Configuration</h3>
                            <span className="text-xs text-slate-400 font-mono">Revision: {bot.configRevision}</span>
                        </div>
                        <div className="p-0">
                            <pre className="text-xs font-mono text-slate-600 bg-slate-50 p-6 overflow-x-auto">
                                {(() => {
                                    try {
                                        return JSON.stringify(typeof bot.configJson === 'string' ? JSON.parse(bot.configJson) : bot.configJson, null, 2);
                                    } catch (e) {
                                        return String(bot.configJson);
                                    }
                                })()}
                            </pre>
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}
