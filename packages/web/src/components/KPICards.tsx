
"use client";

import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import { ArrowUpRight, ArrowDownRight, DollarSign, Activity, Zap } from 'lucide-react';
import clsx from 'clsx';
import { useTranslations } from "next-intl";

const KPI_DATA = [
    {
        id: 'totalProfit',
        value: '$12,450.00',
        trend: '+12.5%',
        isPositive: true,
        icon: DollarSign,
        color: '#14B8A6', // Teal
        data: [10, 15, 12, 20, 25, 22, 30, 28, 35, 40]
    },
    {
        id: 'activeBots',
        value: '8',
        trend: '+2',
        isPositive: true,
        icon: Zap,
        color: '#0EA5E9', // Sky Blue
        data: [5, 6, 6, 7, 6, 8, 8, 9, 8, 8]
    },
    {
        id: 'winRate',
        value: '68.5%',
        trend: '-1.2%',
        isPositive: false,
        icon: Activity,
        color: '#8B5CF6', // Purple
        data: [70, 69, 71, 68, 65, 66, 68, 67, 68, 68.5]
    },
    {
        id: 'volume24h',
        value: '$48.2k',
        trend: '+5.4%',
        isPositive: true,
        icon: Activity,
        color: '#F59E0B', // Amber
        data: [20, 25, 30, 28, 35, 40, 38, 45, 42, 48]
    },
];

export function KPICards() {
    const t = useTranslations("kpi");

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {KPI_DATA.map((kpi) => (
                <div
                    key={kpi.id}
                    className="bg-white p-6 rounded-2xl shadow-diffuse border border-slate-50 transition-transform duration-300 hover:-translate-y-1 relative overflow-hidden group"
                >
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
    );
}
