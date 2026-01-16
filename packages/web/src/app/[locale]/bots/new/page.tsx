
"use client";

import { Sidebar } from "@/components/Sidebar";
import { useState, useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { api, ApiError } from "@/lib/api";
import { Bot, ArrowLeft, Loader2, Save, AlertCircle, Plus, RefreshCw } from "lucide-react";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { useTranslations } from "next-intl";
import { GridConfigForm } from "@/components/GridConfigForm";
import { SymbolPairSelector } from "@/components/SymbolPairSelector";
import clsx from "clsx";

// Valid V1 GridStrategyConfig
const DEFAULT_CONFIG = `{
  "schemaVersion": 2,
  "trigger": {
    "gridType": "percent",
    "basePriceType": "current",
    "riseSell": "0.02",
    "fallBuy": "0.02"
  },
  "order": {
    "orderType": "limit"
  },
  "sizing": {
    "amountMode": "amount",
    "gridSymmetric": true,
    "symmetric": {
      "orderQuantity": "20"
    }
  },
  "position": {
    "maxPositionPercent": "100"
  }
}`;

export default function NewBotPage() {
    useRequireAuth();

    const router = useRouter();
    const t = useTranslations("botNew");
    const tApiErrors = useTranslations("apiErrors");

    const getApiErrorMessage = (err: unknown) => {
        if (err instanceof ApiError && err.code && tApiErrors.has(err.code as any)) {
            return tApiErrors(err.code as any);
        }
        return null;
    };

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [accounts, setAccounts] = useState<any[]>([]);
    const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
    const [accountId, setAccountId] = useState("");
    const [holdingCoins, setHoldingCoins] = useState<string[]>([]);

    const [symbol, setSymbol] = useState("BNB/USDT");
    const [config, setConfig] = useState(DEFAULT_CONFIG);
    const [mode, setMode] = useState<'simple' | 'advanced'>('simple');

    useEffect(() => {
        fetchAccounts();
    }, []);

    // Fetch holding coins when account changes
    useEffect(() => {
        const fetchHoldings = async () => {
            if (!accountId) {
                setHoldingCoins([]);
                return;
            }
            try {
                const balances = await api.accounts.getBalance(accountId);
                // Extract coins with balance > 0
                const coins = Object.entries(balances)
                    .filter(([_, bal]) => parseFloat(bal.total) > 0)
                    .map(([asset]) => asset)
                    .sort((a, b) => {
                        // Prioritize common stables and trading coins
                        const priority = ['USDT', 'USDC', 'BUSD', 'BNB', 'BTC', 'ETH'];
                        const aIdx = priority.indexOf(a);
                        const bIdx = priority.indexOf(b);
                        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
                        if (aIdx !== -1) return -1;
                        if (bIdx !== -1) return 1;
                        return a.localeCompare(b);
                    });
                setHoldingCoins(coins);
            } catch (err) {
                console.error("Failed to fetch holdings:", err);
                setHoldingCoins([]);
            }
        };
        fetchHoldings();
    }, [accountId]);

    const fetchAccounts = async () => {
        setIsLoadingAccounts(true);
        try {
            const data = await api.accounts.list();
            setAccounts(data);
            if (data.length > 0) {
                setAccountId(data[0].id);
            }
        } catch (err) {
            console.error(err);
            setError(t("errors.loadAccounts"));
        } finally {
            setIsLoadingAccounts(false);
        }
    };

    const handleCreateTestAccount = async () => {
        setIsLoadingAccounts(true);
        try {
            const newAccount = await api.accounts.create({
                name: t("testAccountName"),
                exchange: "binance",
                apiKey: "mock-key",
                secret: "mock-secret",
                isTestnet: true,
            });
            await fetchAccounts();
            setAccountId(newAccount.id);
        } catch (err: any) {
            setError(getApiErrorMessage(err) ?? t("errors.createTestAccount"));
        } finally {
            setIsLoadingAccounts(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            await api.bots.create({
                exchangeAccountId: accountId,
                symbol: symbol,
                configJson: config,
            });
            router.push('/bots');
        } catch (err: any) {
            setError(getApiErrorMessage(err) ?? t("errors.createBot"));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex h-screen bg-page overflow-hidden">
            <Sidebar />

            <main className="flex-1 flex flex-col h-full overflow-hidden">
                <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 px-8 py-4 flex items-center gap-4 sticky top-0 z-30">
                    <button onClick={() => router.push('/bots')} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <h1 className="text-xl font-bold text-slate-800">{t("title")}</h1>
                </header>

                <div className="flex-1 overflow-y-auto p-8">
                    <div className="max-w-2xl mx-auto">
                        <form onSubmit={handleCreate} className="space-y-6">
                            {error && (
                                <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl flex items-center gap-3 text-rose-600">
                                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                                    <span className="text-sm font-medium">{error}</span>
                                </div>
                            )}

                            <div className="bg-white p-6 rounded-2xl shadow-diffuse border border-slate-50 space-y-6">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-2">{t("exchangeAccountLabel")}</label>
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <select
                                                value={accountId}
                                                onChange={(e) => setAccountId(e.target.value)}
                                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all font-mono text-sm appearance-none bg-white"
                                                required
                                            >
                                                <option value="" disabled>{t("selectAccountPlaceholder")}</option>
                                                {accounts.map(acc => (
                                                    <option key={acc.id} value={acc.id}>{acc.name || acc.id} ({acc.exchange})</option>
                                                ))}
                                            </select>
                                            {isLoadingAccounts && (
                                                <div className="absolute right-3 top-3.5">
                                                    <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleCreateTestAccount}
                                            disabled={isLoadingAccounts}
                                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-medium text-sm transition-colors flex items-center gap-2"
                                            title={t("createMockTitle")}
                                        >
                                            <Plus className="w-4 h-4" />
                                            {t("createMockButton")}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={fetchAccounts}
                                            disabled={isLoadingAccounts}
                                            className="p-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors"
                                            title={t("refreshTitle")}
                                        >
                                            <RefreshCw className="w-4 h-4" />
                                        </button>
                                    </div>
                                    {accounts.length === 0 && !isLoadingAccounts && (
                                        <p className="mt-2 text-xs text-amber-500 flex items-center gap-1">
                                            <AlertCircle className="w-3 h-3" />
                                            {t("noAccounts")}
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-3">{t("symbolLabel")}</label>
                                    <SymbolPairSelector
                                        value={symbol}
                                        onChange={setSymbol}
                                        baseLabel={t("baseCoinLabel")}
                                        quoteLabel={t("quoteCoinLabel")}
                                        holdingCoins={holdingCoins}
                                    />
                                </div>

                                <div className="flex-1 border-t border-slate-100 pt-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <label className="block text-sm font-bold text-slate-700">{t("configLabel")}</label>
                                        <div className="flex bg-slate-100 p-1 rounded-lg">
                                            <button
                                                type="button"
                                                onClick={() => setMode('simple')}
                                                className={clsx(
                                                    "px-3 py-1.5 text-xs font-bold rounded-md transition-all",
                                                    mode === 'simple' ? "bg-white text-teal-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                                                )}
                                            >
                                                {t("modeSimple")}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setMode('advanced')}
                                                className={clsx(
                                                    "px-3 py-1.5 text-xs font-bold rounded-md transition-all",
                                                    mode === 'advanced' ? "bg-white text-teal-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                                                )}
                                            >
                                                {t("modeAdvanced")}
                                            </button>
                                        </div>
                                    </div>

                                    {mode === 'simple' ? (
                                        <GridConfigForm configJson={config} onChange={setConfig} />
                                    ) : (
                                        <textarea
                                            value={config}
                                            onChange={(e) => setConfig(e.target.value)}
                                            className="w-full h-96 px-4 py-3 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all font-mono text-xs leading-relaxed bg-slate-50"
                                            required
                                        />
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-end pt-4">
                                <button
                                    type="submit"
                                    disabled={isLoading || !accountId}
                                    className="bg-slate-900 hover:bg-black text-white px-8 py-3 rounded-xl font-bold text-sm shadow-lg shadow-slate-900/20 flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed transition-all"
                                >
                                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    {t("submit")}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </main>
        </div>
    );
}
