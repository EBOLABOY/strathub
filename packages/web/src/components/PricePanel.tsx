"use client";

/**
 * 实时价格展示组件
 * 
 * 显示：
 * - 当前价格
 * - 买入/卖出触发价格
 * - 距离触发的百分比
 */

import { useEffect, useState, useCallback } from "react";
import { api, BotTickerInfo } from "@/lib/api";
import { TrendingUp, TrendingDown, RefreshCw, AlertCircle, Activity } from "lucide-react";
import clsx from "clsx";

interface PricePanelProps {
    botId: string;
    className?: string;
    refreshInterval?: number;
}

export function PricePanel({ botId, className, refreshInterval = 5000 }: PricePanelProps) {
    const [ticker, setTicker] = useState<BotTickerInfo | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [prevPrice, setPrevPrice] = useState<number | null>(null);

    const fetchTicker = useCallback(async () => {
        try {
            const data = await api.market.getBotTicker(botId);
            setPrevPrice(ticker?.price ?? null);
            setTicker(data);
            setLastUpdate(new Date());
            setError(null);
        } catch (err: any) {
            setError(err.message || "获取价格失败");
        } finally {
            setIsLoading(false);
        }
    }, [botId, ticker?.price]);

    useEffect(() => {
        fetchTicker();
        const interval = setInterval(fetchTicker, refreshInterval);
        return () => clearInterval(interval);
    }, [fetchTicker, refreshInterval]);

    // 价格变化方向
    const priceDirection = ticker && prevPrice !== null
        ? ticker.price > prevPrice ? 'up' : ticker.price < prevPrice ? 'down' : 'same'
        : 'same';

    if (isLoading) {
        return (
            <div className={clsx("bg-white rounded-2xl border border-slate-100 shadow-sm p-6", className)}>
                <div className="flex items-center justify-center h-32">
                    <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className={clsx("bg-white rounded-2xl border border-slate-100 shadow-sm p-6", className)}>
                <div className="flex items-center justify-center h-32 text-rose-500 gap-2">
                    <AlertCircle className="w-5 h-5" />
                    <span className="text-sm">{error}</span>
                </div>
            </div>
        );
    }

    if (!ticker) return null;

    return (
        <div className={clsx("bg-white rounded-2xl border border-slate-100 shadow-diffuse", className)}>
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-teal-600" />
                    <span className="font-bold text-slate-700">实时行情</span>
                    <span className="text-sm text-slate-400">{ticker.symbol}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>更新于 {lastUpdate?.toLocaleTimeString()}</span>
                    <button
                        onClick={() => fetchTicker()}
                        className="p-1 hover:bg-slate-100 rounded transition-colors"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Price Display */}
            <div className="p-6">
                <div className="text-center mb-6">
                    <div className="text-xs text-slate-400 mb-1">当前价格</div>
                    <div className={clsx(
                        "text-4xl font-bold font-mono transition-colors",
                        priceDirection === 'up' && "text-emerald-600",
                        priceDirection === 'down' && "text-rose-600",
                        priceDirection === 'same' && "text-slate-800"
                    )}>
                        ${ticker.priceFormatted}
                        {priceDirection === 'up' && <TrendingUp className="w-6 h-6 inline-block ml-2" />}
                        {priceDirection === 'down' && <TrendingDown className="w-6 h-6 inline-block ml-2" />}
                    </div>
                </div>

                {/* Trigger Info */}
                {ticker.triggerInfo && (
                    <div className="grid grid-cols-2 gap-4">
                        {/* Sell Trigger */}
                        <div className="bg-gradient-to-br from-rose-50 to-rose-100/50 rounded-xl p-4 border border-rose-100">
                            <div className="flex items-center gap-2 mb-2">
                                <TrendingUp className="w-4 h-4 text-rose-500" />
                                <span className="text-xs font-medium text-rose-600">卖出触发</span>
                            </div>
                            <div className="text-xl font-bold font-mono text-rose-700">
                                ${ticker.triggerInfo.sellTriggerPrice}
                            </div>
                            <div className="text-xs text-rose-500 mt-1">
                                ↑ {ticker.triggerInfo.sellDistance}%
                            </div>
                            <div className="mt-3 h-2 bg-rose-200 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-rose-500 rounded-full transition-all"
                                    style={{
                                        width: `${Math.min(100, (ticker.price / parseFloat(ticker.triggerInfo.sellTriggerPrice)) * 100)}%`
                                    }}
                                />
                            </div>
                        </div>

                        {/* Buy Trigger */}
                        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 rounded-xl p-4 border border-emerald-100">
                            <div className="flex items-center gap-2 mb-2">
                                <TrendingDown className="w-4 h-4 text-emerald-500" />
                                <span className="text-xs font-medium text-emerald-600">买入触发</span>
                            </div>
                            <div className="text-xl font-bold font-mono text-emerald-700">
                                ${ticker.triggerInfo.buyTriggerPrice}
                            </div>
                            <div className="text-xs text-emerald-500 mt-1">
                                ↓ {ticker.triggerInfo.buyDistance}%
                            </div>
                            <div className="mt-3 h-2 bg-emerald-200 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-emerald-500 rounded-full transition-all"
                                    style={{
                                        width: `${Math.min(100, (parseFloat(ticker.triggerInfo.buyTriggerPrice) / ticker.price) * 100)}%`
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
