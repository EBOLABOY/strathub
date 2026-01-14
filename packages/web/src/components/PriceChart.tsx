"use client";

/**
 * 简单价格走势图组件
 * 
 * 使用 SVG 绘制简单的价格走势线
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { RefreshCw, AlertCircle, BarChart3 } from "lucide-react";
import clsx from "clsx";

interface PriceChartProps {
    botId: string;
    className?: string;
    refreshInterval?: number;
    historyCount?: number;
}

interface PricePoint {
    price: number;
    timestamp: number;
}

export function PriceChart({
    botId,
    className,
    refreshInterval = 5000,
    historyCount = 60
}: PriceChartProps) {
    const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const fetchPrice = useCallback(async () => {
        try {
            const data = await api.market.getBotTicker(botId);
            setPriceHistory(prev => {
                const newPoint = { price: data.price, timestamp: data.timestamp };
                const updated = [...prev, newPoint];
                // 保留最近 N 个点
                return updated.slice(-historyCount);
            });
            setError(null);
        } catch (err: any) {
            setError(err.message || "获取价格失败");
        } finally {
            setIsLoading(false);
        }
    }, [botId, historyCount]);

    useEffect(() => {
        fetchPrice();
        const interval = setInterval(fetchPrice, refreshInterval);
        return () => clearInterval(interval);
    }, [fetchPrice, refreshInterval]);

    // 计算图表数据
    const chartData = (() => {
        if (priceHistory.length < 2) return null;

        const prices = priceHistory.map(p => p.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const priceRange = maxPrice - minPrice || 1;

        const width = 400;
        const height = 120;
        const padding = 10;

        const points = priceHistory.map((point, index) => {
            const x = padding + (index / (priceHistory.length - 1)) * (width - padding * 2);
            const y = height - padding - ((point.price - minPrice) / priceRange) * (height - padding * 2);
            return { x, y, ...point };
        });

        // 创建平滑曲线路径
        const pathD = points.reduce((acc, point, index) => {
            if (index === 0) return `M ${point.x} ${point.y}`;

            const prev = points[index - 1];
            const cpx = (prev.x + point.x) / 2;
            return `${acc} Q ${prev.x} ${prev.y} ${cpx} ${(prev.y + point.y) / 2}`;
        }, '') + ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;

        // 创建填充区域路径
        const areaD = pathD +
            ` L ${points[points.length - 1].x} ${height - padding}` +
            ` L ${points[0].x} ${height - padding} Z`;

        const currentPrice = prices[prices.length - 1];
        const priceChange = prices.length > 1 ? currentPrice - prices[0] : 0;
        const priceChangePercent = prices[0] ? (priceChange / prices[0]) * 100 : 0;
        const isUp = priceChange >= 0;

        return {
            width,
            height,
            pathD,
            areaD,
            points,
            minPrice,
            maxPrice,
            currentPrice,
            priceChange,
            priceChangePercent,
            isUp,
        };
    })();

    if (isLoading && priceHistory.length === 0) {
        return (
            <div className={clsx("bg-white rounded-2xl border border-slate-100 shadow-sm p-6", className)}>
                <div className="flex items-center justify-center h-32">
                    <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
                </div>
            </div>
        );
    }

    if (error && priceHistory.length === 0) {
        return (
            <div className={clsx("bg-white rounded-2xl border border-slate-100 shadow-sm p-6", className)}>
                <div className="flex items-center justify-center h-32 text-rose-500 gap-2">
                    <AlertCircle className="w-5 h-5" />
                    <span className="text-sm">{error}</span>
                </div>
            </div>
        );
    }

    return (
        <div className={clsx("bg-white rounded-2xl border border-slate-100 shadow-diffuse overflow-hidden", className)}>
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-indigo-600" />
                    <span className="font-bold text-slate-700">价格走势</span>
                </div>
                {chartData && (
                    <div className={clsx(
                        "flex items-center gap-2 text-sm font-medium",
                        chartData.isUp ? "text-emerald-600" : "text-rose-600"
                    )}>
                        <span>{chartData.isUp ? '+' : ''}{chartData.priceChangePercent.toFixed(2)}%</span>
                    </div>
                )}
            </div>

            {/* Chart */}
            <div className="p-4">
                {chartData ? (
                    <svg
                        ref={svgRef}
                        viewBox={`0 0 ${chartData.width} ${chartData.height}`}
                        className="w-full h-32"
                        preserveAspectRatio="none"
                    >
                        {/* Gradient */}
                        <defs>
                            <linearGradient id={`gradient-${botId}`} x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop
                                    offset="0%"
                                    stopColor={chartData.isUp ? "#10b981" : "#f43f5e"}
                                    stopOpacity="0.3"
                                />
                                <stop
                                    offset="100%"
                                    stopColor={chartData.isUp ? "#10b981" : "#f43f5e"}
                                    stopOpacity="0.05"
                                />
                            </linearGradient>
                        </defs>

                        {/* Area fill */}
                        <path
                            d={chartData.areaD}
                            fill={`url(#gradient-${botId})`}
                        />

                        {/* Line */}
                        <path
                            d={chartData.pathD}
                            fill="none"
                            stroke={chartData.isUp ? "#10b981" : "#f43f5e"}
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />

                        {/* Current price dot */}
                        {chartData.points.length > 0 && (
                            <circle
                                cx={chartData.points[chartData.points.length - 1].x}
                                cy={chartData.points[chartData.points.length - 1].y}
                                r="4"
                                fill={chartData.isUp ? "#10b981" : "#f43f5e"}
                            />
                        )}
                    </svg>
                ) : (
                    <div className="h-32 flex items-center justify-center text-slate-400 text-sm">
                        正在收集价格数据...
                    </div>
                )}

                {/* Price labels */}
                {chartData && (
                    <div className="flex justify-between text-xs text-slate-400 mt-2">
                        <span>高: ${chartData.maxPrice.toFixed(2)}</span>
                        <span>低: ${chartData.minPrice.toFixed(2)}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
