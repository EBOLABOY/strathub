
"use client";

import { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import { ArrowUpRight, ArrowDownRight, DollarSign, Activity, Zap, X } from 'lucide-react';
import clsx from 'clsx';
import { useTranslations } from "next-intl";
import { api } from '@/lib/api';
import { BotStatus, Balance } from '@crypto-strategy-hub/shared';

const KPI_DATA = [
    {
        id: 'totalProfit',
        value: 'Loading...',
        trend: '+12.5%', // Mock for now
        isPositive: true,
        icon: DollarSign,
        color: '#14B8A6', // Teal
        data: [10, 15, 12, 20, 25, 22, 30, 28, 35, 40],
        clickable: true
    },
    {
        id: 'activeBots',
        value: '--',
        trend: '',
        isPositive: true,
        icon: Zap,
        color: '#0EA5E9', // Sky Blue
        data: [5, 6, 6, 7, 6, 8, 8, 9, 8, 8],
        clickable: false
    },
    {
        id: 'winRate',
        value: '68.5%',
        trend: '-1.2%',
        isPositive: false,
        icon: Activity,
        color: '#8B5CF6', // Purple
        data: [70, 69, 71, 68, 65, 66, 68, 67, 68, 68.5],
        clickable: false
    },
    {
        id: 'volume24h',
        value: '$48.2k',
        trend: '+5.4%',
        isPositive: true,
        icon: Activity,
        color: '#F59E0B', // Amber
        data: [20, 25, 30, 28, 35, 40, 38, 45, 42, 48],
        clickable: false
    },
];

interface BalanceDetail {
    asset: string;
    free: string;
    locked: string;
    total: string;
}

export function KPICards() {
    const t = useTranslations("kpi");
    const [stats, setStats] = useState(KPI_DATA);
    const [showBalanceModal, setShowBalanceModal] = useState(false);
    const [balanceDetails, setBalanceDetails] = useState<BalanceDetail[]>([]);
    const [accountName, setAccountName] = useState('');

    useEffect(() => {
        const loadData = async () => {
            try {
                // Fetch accounts and bots data in parallel
                const [accounts, bots] = await Promise.all([
                    api.accounts.list(),
                    api.bots.list()
                ]);

                // Calculate active bots count (RUNNING or WAITING_TRIGGER)
                const activeBots = bots.filter(bot =>
                    bot.status === BotStatus.RUNNING ||
                    bot.status === BotStatus.WAITING_TRIGGER ||
                    bot.status === BotStatus.PAUSED
                ).length;

                // Calculate total bots for trend display
                const totalBots = bots.length;

                // Fetch total assets from first account
                let totalAssets = 0;
                if (accounts.length > 0) {
                    setAccountName(accounts[0].name || 'Account');
                    const balances = await api.accounts.getBalance(accounts[0].id);
                    const stables = ['USDT', 'BUSD', 'USDC', 'FDUSD', 'DAI'];

                    // Store detailed balance for modal
                    const details: BalanceDetail[] = [];
                    Object.entries(balances).forEach(([asset, bal]) => {
                        const total = parseFloat(bal.total);
                        if (total > 0) {
                            details.push({
                                asset,
                                free: bal.free,
                                locked: bal.locked,
                                total: bal.total
                            });
                        }
                        if (stables.includes(asset)) {
                            totalAssets += total;
                        }
                    });

                    // Sort by total value descending
                    details.sort((a, b) => parseFloat(b.total) - parseFloat(a.total));
                    setBalanceDetails(details);
                }

                setStats(prev => {
                    const next = [...prev];
                    // Update total assets
                    next[0] = {
                        ...next[0],
                        value: `$${totalAssets.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    };
                    // Update active bots count
                    next[1] = {
                        ...next[1],
                        value: String(activeBots),
                        trend: `/${totalBots}`,
                        isPositive: activeBots > 0
                    };
                    return next;
                });
            } catch (error) {
                console.error("Failed to fetch dashboard data:", error);
            }
        };

        loadData();
    }, []);

    const handleCardClick = (kpiId: string) => {
        if (kpiId === 'totalProfit') {
            setShowBalanceModal(true);
        }
    };

    return (
        <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {stats.map((kpi) => (
                    <div
                        key={kpi.id}
                        onClick={() => kpi.clickable && handleCardClick(kpi.id)}
                        className={clsx(
                            "bg-white p-6 rounded-2xl shadow-diffuse border border-slate-50 transition-transform duration-300 hover:-translate-y-1 relative overflow-hidden group",
                            kpi.clickable && "cursor-pointer hover:border-teal-200 hover:shadow-lg"
                        )}
                    >
                        {/* Clickable indicator */}
                        {kpi.clickable && (
                            <div className="absolute top-2 right-2 text-xs text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">
                                {t("clickToView")}
                            </div>
                        )}

                        {/* Top Row: Icon and Label */}
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <div className="text-slate-400 text-sm font-medium mb-1">{t(kpi.id)}</div>
                                <div className="text-3xl font-bold text-slate-800 tracking-tight">{kpi.value}</div>
                            </div>
                            <div className={clsx(
                                "w-10 h-10 rounded-xl flex items-center justify-center bg-slate-50 group-hover:bg-opacity-50 transition-colors",
                            )}>
                                <kpi.icon className="w-5 h-5 text-slate-400" />
                            </div>
                        </div>

                        {/* Bottom Row: Trend and Sparkline */}
                        <div className="flex items-end justify-between h-12 mt-4">
                            <div className={clsx(
                                "flex items-center gap-1 text-sm font-semibold px-2 py-1 rounded-lg",
                                kpi.isPositive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                            )}>
                                {kpi.isPositive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                                {kpi.trend}
                            </div>

                            <div className="w-24 h-full relative -mr-2">
                                <ResponsiveContainer
                                    width="100%"
                                    height="100%"
                                    initialDimension={{ width: 1, height: 1 }}
                                    minWidth={1}
                                    minHeight={1}
                                >
                                    <AreaChart data={kpi.data.map(val => ({ val }))}>
                                        <defs>
                                            <linearGradient id={`gradient-${kpi.id}`} x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={kpi.color} stopOpacity={0.3} />
                                                <stop offset="95%" stopColor={kpi.color} stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <Area
                                            type="monotone"
                                            dataKey="val"
                                            stroke={kpi.color}
                                            strokeWidth={2}
                                            fillOpacity={1}
                                            fill={`url(#gradient-${kpi.id})`}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Balance Details Modal */}
            {showBalanceModal && (
                <div
                    className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                    onClick={() => setShowBalanceModal(false)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="flex items-center justify-between p-6 border-b border-slate-100">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">{t("balanceDetails")}</h3>
                                <p className="text-sm text-slate-400">{accountName}</p>
                            </div>
                            <button
                                onClick={() => setShowBalanceModal(false)}
                                className="w-8 h-8 rounded-lg bg-slate-50 hover:bg-slate-100 flex items-center justify-center transition-colors"
                            >
                                <X className="w-4 h-4 text-slate-500" />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 overflow-y-auto max-h-[60vh]">
                            {balanceDetails.length === 0 ? (
                                <div className="text-center py-8 text-slate-400">
                                    {t("noAssets")}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {/* Table Header */}
                                    <div className="grid grid-cols-4 text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 pb-2 border-b border-slate-100">
                                        <div>{t("asset")}</div>
                                        <div className="text-right">{t("available")}</div>
                                        <div className="text-right">{t("locked")}</div>
                                        <div className="text-right">{t("total")}</div>
                                    </div>

                                    {/* Balance Rows */}
                                    {balanceDetails.map((item) => (
                                        <div
                                            key={item.asset}
                                            className="grid grid-cols-4 items-center py-3 px-3 rounded-xl hover:bg-slate-50 transition-colors"
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white text-xs font-bold">
                                                    {item.asset.slice(0, 2)}
                                                </div>
                                                <span className="font-semibold text-slate-700">{item.asset}</span>
                                            </div>
                                            <div className="text-right text-sm text-slate-600 font-mono">
                                                {formatNumber(item.free)}
                                            </div>
                                            <div className="text-right text-sm text-slate-400 font-mono">
                                                {formatNumber(item.locked)}
                                            </div>
                                            <div className="text-right text-sm font-semibold text-slate-800 font-mono">
                                                {formatNumber(item.total)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="p-4 border-t border-slate-100 bg-slate-50">
                            <p className="text-xs text-slate-400 text-center">
                                {t("stablecoinsOnly")}
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function formatNumber(value: string): string {
    const num = parseFloat(value);
    if (num === 0) return '0';
    if (num < 0.0001) return '<0.0001';
    if (num < 1) return num.toFixed(6);
    if (num < 1000) return num.toFixed(4);
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
