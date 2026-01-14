import { BotStatus } from "@crypto-strategy-hub/shared";
import { formatDistanceToNow, differenceInDays, differenceInHours } from 'date-fns';
import { enUS, zhCN } from 'date-fns/locale';
import { Bot, Play, Pause, AlertCircle, Ban, Clock, Activity, Settings } from "lucide-react";
import clsx from "clsx";
import { useLocale, useTranslations } from "next-intl";

interface BotCardProps {
    bot: any;
    onClick: () => void;
}

export function BotCard({ bot, onClick }: BotCardProps) {
    const t = useTranslations("bots"); // Need generic keys
    const tStatus = useTranslations("botStatus");
    const locale = useLocale();

    const formatStatus = (status: BotStatus | string) => {
        return tStatus.has(status as any) ? tStatus(status as any) : String(status);
    };

    const getTokenStyle = (symbol: string) => {
        const s = symbol.toUpperCase();
        if (s.includes('BNB')) return { bg: 'bg-[#F3BA2F]', text: 'text-white' };
        if (s.includes('BTC')) return { bg: 'bg-[#F7931A]', text: 'text-white' };
        if (s.includes('ETH')) return { bg: 'bg-[#627EEA]', text: 'text-white' };
        if (s.includes('USDT')) return { bg: 'bg-[#26A17B]', text: 'text-white' };
        return { bg: 'bg-slate-800', text: 'text-white' };
    };

    const tokenStyle = getTokenStyle(bot.symbol);

    // 计算运行时长或创建时长
    const getDuration = () => {
        try {
            const date = new Date(bot.createdAt);
            const dateFnsLocale = locale === 'zh' ? zhCN : enUS;
            return formatDistanceToNow(date, { locale: dateFnsLocale, addSuffix: false });
        } catch {
            return '--';
        }
    };

    // 如果正在运行，显示高亮的运行时间；否则显示创建时间
    const isRunning = bot.status === 'RUNNING';

    return (
        <div
            onClick={onClick}
            className="group relative bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer overflow-hidden"
        >
            {/* Status Border Top - Slight accent */}
            <div className={clsx(
                "absolute top-0 left-0 w-full h-1 opacity-0 group-hover:opacity-100 transition-opacity",
                bot.status === 'RUNNING' && "bg-emerald-500",
                bot.status === 'PAUSED' && "bg-amber-400",
                bot.status === 'ERROR' && "bg-rose-500",
            )} />

            {/* Header: Token & Exchange */}
            <div className="flex justify-between items-start mb-5">
                <div className="flex items-center gap-3">
                    <div className={clsx(
                        "w-12 h-12 rounded-xl flex items-center justify-center font-bold text-sm shadow-inner",
                        tokenStyle.bg, tokenStyle.text
                    )}>
                        {bot.symbol.split('/')[0]}
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-800 text-base">{bot.symbol}</h3>
                        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                            <Bot className="w-3 h-3" />
                            <span>Binance</span>
                        </div>
                    </div>
                </div>
                {/* Status Badge (Pill) - Moved to top right for clarity */}
                <div className={clsx(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border",
                    bot.status === 'RUNNING' ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                        bot.status === 'PAUSED' ? "bg-amber-50 text-amber-600 border-amber-100" :
                            bot.status === 'ERROR' ? "bg-rose-50 text-rose-600 border-rose-100" :
                                "bg-slate-50 text-slate-500 border-slate-100"
                )}>
                    <div className={clsx(
                        "w-1.5 h-1.5 rounded-full",
                        bot.status === 'RUNNING' ? "bg-emerald-500 animate-pulse" :
                            bot.status === 'PAUSED' ? "bg-amber-500" :
                                bot.status === 'ERROR' ? "bg-rose-500" :
                                    "bg-slate-400"
                    )} />
                    {formatStatus(bot.status)}
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 mb-4">
                {/* Runtime / Age */}
                <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-50 group-hover:border-slate-100 transition-colors">
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mb-1">
                        <Clock className="w-3 h-3" />
                        {t("metrics.runtime") || "运行时长"}
                    </div>
                    <div className="text-sm font-bold text-slate-700 truncate">
                        {getDuration()}
                    </div>
                </div>

                {/* Profit (Placeholder for now) */}
                <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-50 group-hover:border-slate-100 transition-colors">
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mb-1">
                        <Activity className="w-3 h-3" />
                        {t("metrics.pnlTotal")}
                    </div>
                    <div className="text-sm font-bold text-slate-400">
                        {t("metrics.na")}
                    </div>
                </div>
            </div>

            {/* Footer Action Hint (Optional, subtle arrow or similar) */}
            <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform translate-y-2 group-hover:translate-y-0">
                <span className="text-xs font-medium text-teal-600 flex items-center gap-1">
                    {t("viewDetails") || "查看详情"} &rarr;
                </span>
            </div>
        </div>
    );
}
