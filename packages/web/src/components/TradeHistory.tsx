import { useEffect, useState } from "react";
import { format } from "date-fns";
import clsx from "clsx";
import { api } from "@/lib/api";
import { Loader2, ArrowUpRight, ArrowDownLeft, RefreshCw, History } from "lucide-react";
import { useTranslations } from "next-intl";

interface Trade {
    id: string;
    symbol: string;
    side: string;
    price: string;
    amount: string;
    fee: string;
    feeCurrency: string;
    timestamp: string;
    clientOrderId?: string;
}

interface TradeHistoryProps {
    botId: string;
    className?: string;
}

export function TradeHistory({ botId, className }: TradeHistoryProps) {
    const [trades, setTrades] = useState<Trade[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const t = useTranslations("botDetail"); // Assuming reuse or new keys needed

    const fetchTrades = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await api.bots.getTrades(botId);
            // @ts-ignore - API definition in library might be slightly off compared to runtime, safety check
            if (Array.isArray(data)) {
                setTrades(data);
            } else if (data && Array.isArray(data.trades)) {
                setTrades(data.trades);
            } else {
                setTrades([]);
            }
        } catch (err: any) {
            setError(err.message || "Failed to load trades");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (botId) {
            fetchTrades();
        }
    }, [botId]);

    // Format helpers
    const formatTime = (dateStr: string) => {
        try {
            return format(new Date(dateStr), "yy-MM-dd HH:mm:ss");
        } catch {
            return dateStr;
        }
    };

    return (
        <section className={clsx("bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden", className)}>
            <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/50">
                <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-slate-500" />
                    <h3 className="font-bold text-slate-700 text-sm">{t("tradeHistory") || "交易历史"}</h3>
                    <span className="text-xs text-slate-400 font-mono">({trades.length})</span>
                </div>
                <button
                    onClick={fetchTrades}
                    disabled={isLoading}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                    <RefreshCw className={clsx("w-4 h-4", isLoading && "animate-spin")} />
                </button>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-xs text-slate-500 uppercase font-medium">
                        <tr>
                            <th className="px-4 py-3 whitespace-nowrap">{t("tradeTime") || "时间"}</th>
                            <th className="px-4 py-3 whitespace-nowrap">{t("tradeSide") || "方向"}</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap">{t("tradePrice") || "价格"}</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap">{t("tradeAmount") || "数量"}</th>
                            <th className="px-4 py-3 text-right whitespace-nowrap">{t("tradeFee") || "手续费"}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {trades.length === 0 && !isLoading && !error && (
                            <tr>
                                <td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-xs">
                                    {t("noTrades") || "暂无成交记录"}
                                </td>
                            </tr>
                        )}

                        {isLoading && trades.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-4 py-8 text-center">
                                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-300" />
                                </td>
                            </tr>
                        )}

                        {error && (
                            <tr>
                                <td colSpan={5} className="px-4 py-4 text-center text-rose-500 text-xs">
                                    {error}
                                </td>
                            </tr>
                        )}

                        {trades.map((trade) => (
                            <tr key={trade.id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                                    {formatTime(trade.timestamp)}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                    <span className={clsx(
                                        "flex items-center gap-1 font-bold text-xs px-2 py-0.5 rounded-full w-fit",
                                        trade.side.toLowerCase() === 'buy'
                                            ? "bg-emerald-50 text-emerald-600"
                                            : "bg-rose-50 text-rose-600"
                                    )}>
                                        {trade.side.toLowerCase() === 'buy' ? (
                                            <ArrowDownLeft className="w-3 h-3" />
                                        ) : (
                                            <ArrowUpRight className="w-3 h-3" />
                                        )}
                                        {trade.side.toUpperCase()}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-right font-mono font-medium text-slate-700 whitespace-nowrap">
                                    {trade.price}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-slate-600 whitespace-nowrap">
                                    {trade.amount}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-xs text-slate-400 whitespace-nowrap">
                                    {trade.fee} {trade.feeCurrency}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
