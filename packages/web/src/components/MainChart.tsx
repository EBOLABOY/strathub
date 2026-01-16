
"use client";

import { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useTranslations } from "next-intl";
import { api, ChartDataPoint } from '@/lib/api';

type Period = '1h' | '1d' | '1w' | '1m' | '1y';

export function MainChart() {
    const t = useTranslations("chart");
    const [data, setData] = useState<ChartDataPoint[]>([]);
    const [selectedPeriod, setSelectedPeriod] = useState<Period>('1d');
    const [loading, setLoading] = useState(true);

    const periods: { key: Period; label: string }[] = [
        { key: "1h", label: t("periods.h1") },
        { key: "1d", label: t("periods.d1") },
        { key: "1w", label: t("periods.w1") },
        { key: "1m", label: t("periods.m1") },
        { key: "1y", label: t("periods.y1") },
    ];

    useEffect(() => {
        const loadChartData = async () => {
            try {
                setLoading(true);
                const chartData = await api.dashboard.getChart(selectedPeriod);
                setData(chartData);
            } catch (error) {
                console.error("Failed to load chart data:", error);
                // Fallback to empty data
                setData([]);
            } finally {
                setLoading(false);
            }
        };

        loadChartData();
    }, [selectedPeriod]);

    const handlePeriodChange = (period: Period) => {
        setSelectedPeriod(period);
    };

    return (
        <div className="bg-white p-6 rounded-2xl shadow-diffuse border border-slate-50 h-[400px] flex flex-col">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-lg font-bold text-slate-700">{t("title")}</h3>
                    <p className="text-sm text-slate-400">{t("subtitle")}</p>
                </div>
                <div className="flex gap-2">
                    {periods.map((period) => (
                        <button
                            key={period.key}
                            onClick={() => handlePeriodChange(period.key)}
                            className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${selectedPeriod === period.key
                                ? "bg-teal-500 text-white"
                                : "text-slate-500 bg-slate-50 hover:bg-slate-100"
                                }`}
                        >
                            {period.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 w-full min-h-0">
                {loading ? (
                    <div className="h-full flex items-center justify-center">
                        <div className="animate-pulse text-slate-400">{t("loading") || "Loading..."}</div>
                    </div>
                ) : data.length === 0 ? (
                    <div className="h-full flex items-center justify-center">
                        <div className="text-slate-400">{t("noData") || "No data available"}</div>
                    </div>
                ) : (
                    <ResponsiveContainer
                        width="100%"
                        height="100%"
                        initialDimension={{ width: 1, height: 1 }}
                        minWidth={1}
                        minHeight={1}
                    >
                        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#0EA5E9" stopOpacity={0.2} />
                                    <stop offset="95%" stopColor="#0EA5E9" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                            <XAxis
                                dataKey="name"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#94A3B8', fontSize: 12 }}
                                dy={10}
                            />
                            <YAxis
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#94A3B8', fontSize: 12 }}
                                tickFormatter={(value) => {
                                    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                                    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
                                    return value.toFixed(0);
                                }}
                            />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: '#fff',
                                    borderRadius: '12px',
                                    border: 'none',
                                    boxShadow: '0 4px 20px -5px rgba(0,0,0,0.1)'
                                }}
                                itemStyle={{ color: '#0EA5E9', fontWeight: 'bold' }}
                                cursor={{ stroke: '#CBD5E1', strokeDasharray: '3 3' }}
                                formatter={(value) => {
                                    const numValue = typeof value === 'number' ? value : 0;
                                    return [`$${numValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, t("value") || "Value"];
                                }}
                            />
                            <Area
                                type="monotone"
                                dataKey="value"
                                stroke="#0EA5E9"
                                strokeWidth={3}
                                fillOpacity={1}
                                fill="url(#colorValue)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}
