"use client";

import { Sidebar } from "@/components/Sidebar";
import { GridPreviewChart } from "@/components/GridPreviewChart";
import { useBot } from "@/lib/hooks";
import { useParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import {
    Bot, ArrowLeft, Play, Pause, Square, Trash2,
    Activity, Clock, AlertTriangle, Loader2, Eye, ShieldCheck, XCircle, CheckCircle, Wifi, WifiOff
} from "lucide-react";
import clsx from 'clsx';
import { BotStatus } from "@crypto-strategy-hub/shared";
import { api, ApiError } from "@/lib/api";
import { useState, useEffect } from "react";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { useTranslations } from "next-intl";
import { useBotSSE } from "@/lib/useSSE";
import { PricePanel } from "@/components/PricePanel";
import { PriceChart } from "@/components/PriceChart";
import { TradeHistory } from "@/components/TradeHistory";

export function BotDetail() {
    useRequireAuth();

    const t = useTranslations("botDetail");
    const tStatus = useTranslations("botStatus");
    const tApiErrors = useTranslations("apiErrors");
    const tPreviewIssues = useTranslations("previewIssues");

    const params = useParams();
    const router = useRouter();
    const id = params?.id as string;
    const { bot, runtime, isLoading, error, refresh } = useBot(id);

    // SSE 实时状态更新
    const { status: sseStatus, botStatus: sseBotStatus, isConnected } = useBotSSE(id);

    // 当 SSE 收到更新时刷新数据
    useEffect(() => {
        if (sseBotStatus && sseBotStatus.statusVersion !== runtime?.statusVersion) {
            refresh();
        }
    }, [sseBotStatus, runtime?.statusVersion, refresh]);

    // Action State
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    // Preview State
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewResult, setPreviewResult] = useState<any>(null);
    const [showPreview, setShowPreview] = useState(false);

    // Delete State
    const [showDelete, setShowDelete] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);

    const formatStatus = (status: BotStatus | string) => {
        return tStatus.has(status as any) ? tStatus(status as any) : String(status);
    };

    const getApiErrorMessage = (err: unknown) => {
        if (err instanceof ApiError && err.code && tApiErrors.has(err.code as any)) {
            return tApiErrors(err.code as any);
        }
        return null;
    };

    const formatIssueMessage = (issue: any) => {
        const code = issue?.code as string | undefined;
        if (code && tPreviewIssues.has(code as any)) {
            return tPreviewIssues(code as any);
        }
        return issue?.message ? String(issue.message) : String(code ?? "");
    };

    const handleAction = async (action: 'start' | 'stop' | 'pause' | 'resume') => {
        setActionLoading(action);
        setActionError(null);
        try {
            await api.bots.control(id, action);
            refresh(); // Poll immediately
        } catch (err: any) {
            if (err instanceof ApiError && err.code === 'CONFIG_VALIDATION_ERROR') {
                try {
                    setPreviewLoading(true);
                    const res = await api.bots.preview(id);
                    setPreviewResult(res);
                    setShowPreview(true);
                } catch { }
                finally {
                    setPreviewLoading(false);
                }
            }

            const apiErrorMessage = getApiErrorMessage(err);
            if (apiErrorMessage) {
                setActionError(apiErrorMessage);
                return;
            }

            const actionLabel =
                action === "start" ? t("start") :
                    action === "pause" ? t("pause") :
                        action === "resume" ? t("resume") :
                            t("stop");

            setActionError(t("actions.failed", { action: actionLabel }));
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
            const apiErrorMessage = getApiErrorMessage(err);
            setActionError(apiErrorMessage || t("actions.previewFailed"));
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleDelete = async () => {
        setDeleteLoading(true);
        setActionError(null);

        try {
            await api.bots.delete(id);
            setShowDelete(false);
            router.push('/bots');
        } catch (err: any) {
            const apiErrorMessage = getApiErrorMessage(err);
            setActionError(apiErrorMessage || t("actions.deleteFailed"));
        } finally {
            setDeleteLoading(false);
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
                    <span>{error || t("notFound")}</span>
                </div>
                <button onClick={() => router.push('/bots')} className="text-slate-500 hover:underline">
                    {t("backToList")}
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
                                <div className="text-xs text-slate-400 font-mono">{t("idPrefix", { id: bot.id.slice(0, 8) })}</div>
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
                            {formatStatus(bot.status)}
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

                        {(() => {
                            const canStart = bot.status === BotStatus.DRAFT || bot.status === BotStatus.STOPPED;
                            const canPause = bot.status === BotStatus.RUNNING || bot.status === BotStatus.WAITING_TRIGGER;
                            const canResume = bot.status === BotStatus.PAUSED;
                            const canStop = [
                                BotStatus.WAITING_TRIGGER,
                                BotStatus.RUNNING,
                                BotStatus.PAUSED,
                                BotStatus.STOPPING,
                            ].includes(bot.status as any);
                            const canDelete = [BotStatus.DRAFT, BotStatus.STOPPED, BotStatus.ERROR].includes(bot.status as any);
                            const stopping = bot.status === BotStatus.STOPPING;

                            return (
                                <>
                                    {/* Preview (Only for STOPPED/DRAFT) */}
                                    {canStart && (
                                        <button
                                            onClick={handlePreview}
                                            disabled={previewLoading || !!actionLoading}
                                            className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 py-2 rounded-lg text-sm font-bold shadow-sm disabled:opacity-50 transition-all mr-2"
                                        >
                                            {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                                            {t("preview")}
                                        </button>
                                    )}

                                    {/* Start */}
                                    {canStart && (
                                        <button
                                            onClick={() => handleAction('start')}
                                            disabled={!!actionLoading || previewLoading}
                                            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition-all"
                                        >
                                            {actionLoading === 'start' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                            {t("start")}
                                        </button>
                                    )}

                                    {/* Pause */}
                                    {canPause && (
                                        <button
                                            onClick={() => handleAction('pause')}
                                            disabled={!!actionLoading}
                                            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-amber-500/20 disabled:opacity-50 transition-all"
                                        >
                                            {actionLoading === 'pause' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
                                            {t("pause")}
                                        </button>
                                    )}

                                    {/* Resume */}
                                    {canResume && (
                                        <button
                                            onClick={() => handleAction('resume')}
                                            disabled={!!actionLoading}
                                            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition-all"
                                        >
                                            {actionLoading === 'resume' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                            {t("resume")}
                                        </button>
                                    )}

                                    {/* Stop */}
                                    {canStop && (
                                        <button
                                            onClick={() => handleAction('stop')}
                                            disabled={!!actionLoading || stopping}
                                            className="flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-rose-500/20 disabled:opacity-50 transition-all"
                                        >
                                            {actionLoading === 'stop' || stopping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4 fill-current" />}
                                            {t("stop")}
                                        </button>
                                    )}

                                    {/* Delete */}
                                    {canDelete && (
                                        <button
                                            onClick={() => setShowDelete(true)}
                                            disabled={!!actionLoading || previewLoading || deleteLoading}
                                            className="flex items-center gap-2 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 px-4 py-2 rounded-lg text-sm font-bold shadow-sm disabled:opacity-50 transition-all ml-2"
                                        >
                                            {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                            {t("delete")}
                                        </button>
                                    )}
                                </>
                            );
                        })()}
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
                                    {t("riskAnalysisTitle")}
                                </div>
                                <button onClick={() => setShowPreview(false)} className="text-teal-600 hover:text-teal-800">
                                    <XCircle className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    {/* Validations */}
                                    <div>
                                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">{t("healthCheck")}</h4>
                                        <div className="space-y-2">
                                            {previewResult.issues && previewResult.issues.length > 0 ? (
                                                previewResult.issues.map((issue: any, i: number) => (
                                                    <div key={i} className={clsx(
                                                        "flex items-start gap-2 text-sm p-3 rounded-lg border",
                                                        issue.severity === 'ERROR' ? "bg-rose-50 text-rose-700 border-rose-100" :
                                                            issue.severity === 'WARN' ? "bg-amber-50 text-amber-700 border-amber-100" :
                                                                "bg-slate-50 text-slate-700 border-slate-200"
                                                    )}>
                                                        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                                        <span>{formatIssueMessage(issue)}</span>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-3 py-2 rounded-lg text-sm">
                                                    <CheckCircle className="w-4 h-4" />
                                                    {t("previewOk")}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Estimates */}
                                    <div>
                                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">{t("estimates")}</h4>
                                        <div className="bg-slate-50 rounded-xl p-4 text-sm space-y-2">
                                            <div className="flex justify-between">
                                                <span className="text-slate-500">{t("spread")}</span>
                                                <span className="font-mono font-bold text-slate-700">{previewResult.estimates?.spreadPercent || '0'}%</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-500">{t("estFee")}</span>
                                                <span className="font-mono font-bold text-slate-700">{previewResult.estimates?.estimatedFeeQuoteRoundTrip || '0'}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-500">{t("estNetProfit")}</span>
                                                <span className={clsx("font-mono font-bold", parseFloat(previewResult.estimates?.estimatedNetProfitQuoteRoundTrip || '0') >= 0 ? "text-emerald-600" : "text-rose-600")}>
                                                    {previewResult.estimates?.estimatedNetProfitQuoteRoundTrip || '0'}
                                                </span>
                                            </div>
                                            <div className="pt-2 border-t border-slate-200 mt-2">
                                                <div className="flex justify-between">
                                                    <span className="text-slate-500">{t("orderCount")}</span>
                                                    <span className="font-mono font-bold text-slate-700">{previewResult.orders?.length || 0}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Market Overview */}
                    <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <PricePanel botId={id} className="h-full" />
                        <PriceChart botId={id} className="lg:col-span-2 h-full" />
                    </section>

                    {/* Grid Preview Chart */}
                    {showPreview && previewResult && previewResult.basePrice && (
                        <GridPreviewChart
                            data={previewResult}
                            className="animate-in slide-in-from-bottom-4 duration-300"
                        />
                    )}

                    {/* SSE Connection Status */}
                    <div className="flex items-center gap-2 text-xs">
                        <div className={clsx(
                            "flex items-center gap-1.5 px-2 py-1 rounded-full",
                            isConnected ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"
                        )}>
                            {isConnected ? (
                                <>
                                    <Wifi className="w-3 h-3" />
                                    <span>{t("realtimeConnected") || "实时连接"}</span>
                                </>
                            ) : (
                                <>
                                    <WifiOff className="w-3 h-3" />
                                    <span>{t("pollingMode") || "轮询模式"}</span>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Runtime Stats */}
                    <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-white p-6 rounded-2xl shadow-diffuse border border-slate-50">
                            <div className="flex items-center gap-2 mb-2 text-slate-400 text-sm font-medium">
                                <Activity className="w-4 h-4" />
                                {t("runId")}
                            </div>
                            <div className="text-lg font-mono font-bold text-slate-700 truncate">
                                {runtime?.runId ? runtime.runId.slice(0, 8) : t("none")}
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-2xl shadow-diffuse border border-slate-50">
                            <div className="flex items-center gap-2 mb-2 text-slate-400 text-sm font-medium">
                                <Clock className="w-4 h-4" />
                                {t("statusVersion")}
                            </div>
                            <div className="text-lg font-mono font-bold text-slate-700">
                                v{runtime?.statusVersion ?? 0}
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-2xl shadow-diffuse border border-slate-50">
                            <div className="flex items-center gap-2 mb-2 text-slate-400 text-sm font-medium">
                                <AlertTriangle className="w-4 h-4" />
                                {t("lastError")}
                            </div>
                            <div className="text-sm font-medium text-rose-500 line-clamp-2">
                                {runtime?.lastError || t("none")}
                            </div>
                        </div>
                    </section>

                    {/* Trade History */}
                    {bot.status !== "DRAFT" && (
                        <TradeHistory botId={id} />
                    )}

                    {/* Config Preview */}
                    <section className="bg-white rounded-2xl shadow-diffuse border border-slate-50 overflow-hidden">
                        <div className="p-4 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between">
                            <h3 className="font-bold text-slate-700 text-sm">{t("config")}</h3>
                            <span className="text-xs text-slate-400 font-mono">{t("revision", { revision: bot.configRevision })}</span>
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

            {showDelete && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                        <div className="p-6 border-b border-slate-100">
                            <h2 className="text-lg font-bold text-slate-800">{t("deleteModalTitle")}</h2>
                            <p className="text-sm text-slate-400 mt-1">{t("deleteModalSubtitle")}</p>
                        </div>

                        <div className="p-6 flex items-center justify-end gap-3">
                            <button
                                onClick={() => setShowDelete(false)}
                                disabled={deleteLoading}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors disabled:opacity-50"
                            >
                                {t("cancel")}
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={deleteLoading}
                                className="px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-lg font-bold transition-colors flex items-center gap-2 disabled:opacity-50"
                            >
                                {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                {t("confirmDelete")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
