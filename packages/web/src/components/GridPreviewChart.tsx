"use client";

/**
 * GridPreviewChart - 网格策略预览图表
 * 
 * 可视化展示：
 * - 基准价格线
 * - 买入触发价
 * - 卖出触发价
 * - 价格区间（如果配置了 priceMin/priceMax）
 * - 保底价（floor price）
 */

import { useMemo } from 'react';
import clsx from 'clsx';
import { TrendingUp, TrendingDown, Target, AlertTriangle, ShieldAlert } from 'lucide-react';

export interface PreviewLine {
    kind: 'reference' | 'trigger' | 'bound' | 'risk';
    label: string;
    price: string;
}

export interface PreviewOrder {
    side: 'buy' | 'sell';
    type: 'limit' | 'market';
    price?: string;
    quoteAmount: string;
    baseAmount?: string;
}

export interface PreviewData {
    basePrice: string;
    buyTriggerPrice: string;
    sellTriggerPrice: string;
    lines?: PreviewLine[];
    orders?: PreviewOrder[];
    estimates?: {
        spreadPercent?: string;
        spreadQuote?: string;
        estimatedFeeQuoteRoundTrip?: string;
        estimatedNetProfitQuoteRoundTrip?: string;
    };
}

interface GridPreviewChartProps {
    data: PreviewData;
    currentPrice?: string;
    className?: string;
}

export function GridPreviewChart({ data, currentPrice, className }: GridPreviewChartProps) {
    // 计算价格范围用于图表缩放
    const priceRange = useMemo(() => {
        const prices: number[] = [];

        if (data.basePrice) prices.push(parseFloat(data.basePrice));
        if (data.buyTriggerPrice) prices.push(parseFloat(data.buyTriggerPrice));
        if (data.sellTriggerPrice) prices.push(parseFloat(data.sellTriggerPrice));
        if (currentPrice) prices.push(parseFloat(currentPrice));

        // 添加 lines 中的价格
        data.lines?.forEach(line => {
            if (line.price) prices.push(parseFloat(line.price));
        });

        if (prices.length === 0) return { min: 0, max: 100, range: 100 };

        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const range = max - min;

        // 添加 10% 的边距
        const padding = range * 0.1 || max * 0.05;

        return {
            min: min - padding,
            max: max + padding,
            range: range + padding * 2,
        };
    }, [data, currentPrice]);

    // 将价格转换为百分比位置（从底部开始）
    const priceToPercent = (price: string | number): number => {
        const p = typeof price === 'string' ? parseFloat(price) : price;
        if (priceRange.range === 0) return 50;
        return ((p - priceRange.min) / priceRange.range) * 100;
    };

    const basePercent = priceToPercent(data.basePrice);
    const buyPercent = priceToPercent(data.buyTriggerPrice);
    const sellPercent = priceToPercent(data.sellTriggerPrice);
    const currentPercent = currentPrice ? priceToPercent(currentPrice) : null;

    // 提取特殊价格线
    const floorLine = data.lines?.find(l => l.kind === 'risk' && l.label.toLowerCase().includes('floor'));
    const boundLines = data.lines?.filter(l => l.kind === 'bound') || [];

    return (
        <div className={clsx("bg-slate-900 rounded-2xl p-6 relative overflow-hidden", className)}>
            {/* 背景网格 */}
            <div className="absolute inset-0 opacity-10">
                <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="white" strokeWidth="0.5" />
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid)" />
                </svg>
            </div>

            {/* 标题 */}
            <div className="relative mb-6">
                <h3 className="text-white font-bold text-lg flex items-center gap-2">
                    <Target className="w-5 h-5 text-teal-400" />
                    网格预览
                </h3>
                <p className="text-slate-400 text-sm mt-1">触发价位可视化</p>
            </div>

            {/* 图表区域 */}
            <div className="relative h-64 flex">
                {/* Y 轴价格标签 */}
                <div className="w-20 h-full flex flex-col justify-between text-right pr-3 text-xs font-mono">
                    <span className="text-slate-400">{priceRange.max.toFixed(2)}</span>
                    <span className="text-slate-400">{((priceRange.max + priceRange.min) / 2).toFixed(2)}</span>
                    <span className="text-slate-400">{priceRange.min.toFixed(2)}</span>
                </div>

                {/* 主图表区域 */}
                <div className="flex-1 relative border-l border-b border-slate-700">
                    {/* 卖出触发线 */}
                    <div
                        className="absolute left-0 right-0 border-t-2 border-dashed border-rose-500 flex items-center"
                        style={{ bottom: `${sellPercent}%` }}
                    >
                        <div className="absolute right-0 px-2 py-1 bg-rose-500 text-white text-xs font-bold rounded-l-md transform translate-y-[-50%] flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" />
                            卖出 {parseFloat(data.sellTriggerPrice).toFixed(4)}
                        </div>
                    </div>

                    {/* 基准价线 */}
                    <div
                        className="absolute left-0 right-0 border-t-2 border-teal-400 flex items-center"
                        style={{ bottom: `${basePercent}%` }}
                    >
                        <div className="absolute left-0 px-2 py-1 bg-teal-500 text-white text-xs font-bold rounded-r-md transform translate-y-[-50%] flex items-center gap-1">
                            <Target className="w-3 h-3" />
                            基准 {parseFloat(data.basePrice).toFixed(4)}
                        </div>
                    </div>

                    {/* 买入触发线 */}
                    <div
                        className="absolute left-0 right-0 border-t-2 border-dashed border-emerald-500 flex items-center"
                        style={{ bottom: `${buyPercent}%` }}
                    >
                        <div className="absolute right-0 px-2 py-1 bg-emerald-500 text-white text-xs font-bold rounded-l-md transform translate-y-[-50%] flex items-center gap-1">
                            <TrendingDown className="w-3 h-3" />
                            买入 {parseFloat(data.buyTriggerPrice).toFixed(4)}
                        </div>
                    </div>

                    {/* 当前价格指示器 */}
                    {currentPercent !== null && (
                        <div
                            className="absolute left-0 right-0 flex items-center"
                            style={{ bottom: `${currentPercent}%` }}
                        >
                            <div className="w-full border-t border-amber-400 border-dotted" />
                            <div className="absolute left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                                <div className="w-3 h-3 bg-amber-400 rounded-full shadow-lg shadow-amber-400/50 animate-pulse" />
                            </div>
                            <div className="absolute left-1/2 transform translate-x-2 -translate-y-1/2 text-xs text-amber-400 font-mono whitespace-nowrap">
                                当前 {parseFloat(currentPrice!).toFixed(4)}
                            </div>
                        </div>
                    )}

                    {/* 保底价线（如果有） */}
                    {floorLine && (
                        <div
                            className="absolute left-0 right-0 border-t-2 border-rose-600 flex items-center"
                            style={{ bottom: `${priceToPercent(floorLine.price)}%` }}
                        >
                            <div className="absolute left-0 px-2 py-1 bg-rose-600 text-white text-xs font-bold rounded-r-md transform translate-y-[-50%] flex items-center gap-1">
                                <ShieldAlert className="w-3 h-3" />
                                止损 {parseFloat(floorLine.price).toFixed(4)}
                            </div>
                        </div>
                    )}

                    {/* 价格区间边界（如果有） */}
                    {boundLines.map((line, i) => (
                        <div
                            key={i}
                            className="absolute left-0 right-0 border-t border-slate-500 border-dotted"
                            style={{ bottom: `${priceToPercent(line.price)}%` }}
                        >
                            <span className="absolute left-2 text-xs text-slate-400 transform -translate-y-full">
                                {line.label}
                            </span>
                        </div>
                    ))}

                    {/* 网格区间填充 */}
                    <div
                        className="absolute left-0 right-0 bg-gradient-to-t from-emerald-500/10 to-rose-500/10"
                        style={{
                            bottom: `${buyPercent}%`,
                            height: `${sellPercent - buyPercent}%`
                        }}
                    />
                </div>
            </div>

            {/* 图例 */}
            <div className="relative mt-6 flex flex-wrap gap-4 text-xs">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-0.5 bg-teal-400" />
                    <span className="text-slate-400">基准价</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-0.5 bg-emerald-500 border-dashed border-t" />
                    <span className="text-slate-400">买入触发</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-0.5 bg-rose-500 border-dashed border-t" />
                    <span className="text-slate-400">卖出触发</span>
                </div>
                {currentPrice && (
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-amber-400 rounded-full" />
                        <span className="text-slate-400">当前价格</span>
                    </div>
                )}
            </div>

            {/* 收益估算 */}
            {data.estimates && (
                <div className="relative mt-6 grid grid-cols-3 gap-4">
                    <div className="bg-slate-800/50 rounded-xl p-4">
                        <div className="text-slate-400 text-xs mb-1">网格利差</div>
                        <div className="text-white font-bold font-mono">
                            {data.estimates.spreadPercent || '0'}%
                        </div>
                    </div>
                    <div className="bg-slate-800/50 rounded-xl p-4">
                        <div className="text-slate-400 text-xs mb-1">预估手续费</div>
                        <div className="text-amber-400 font-bold font-mono">
                            {data.estimates.estimatedFeeQuoteRoundTrip || '0'}
                        </div>
                    </div>
                    <div className="bg-slate-800/50 rounded-xl p-4">
                        <div className="text-slate-400 text-xs mb-1">预估净利</div>
                        <div className={clsx(
                            "font-bold font-mono",
                            parseFloat(data.estimates.estimatedNetProfitQuoteRoundTrip || '0') >= 0
                                ? "text-emerald-400"
                                : "text-rose-400"
                        )}>
                            {data.estimates.estimatedNetProfitQuoteRoundTrip || '0'}
                        </div>
                    </div>
                </div>
            )}

            {/* 预期订单 */}
            {data.orders && data.orders.length > 0 && (
                <div className="relative mt-6">
                    <h4 className="text-slate-400 text-xs font-medium mb-3 uppercase tracking-wide">预期首单</h4>
                    <div className="space-y-2">
                        {data.orders.map((order, i) => (
                            <div
                                key={i}
                                className={clsx(
                                    "flex items-center justify-between p-3 rounded-lg border",
                                    order.side === 'buy'
                                        ? "bg-emerald-500/10 border-emerald-500/30"
                                        : "bg-rose-500/10 border-rose-500/30"
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    {order.side === 'buy' ? (
                                        <TrendingDown className="w-4 h-4 text-emerald-400" />
                                    ) : (
                                        <TrendingUp className="w-4 h-4 text-rose-400" />
                                    )}
                                    <span className={clsx(
                                        "font-bold text-sm",
                                        order.side === 'buy' ? "text-emerald-400" : "text-rose-400"
                                    )}>
                                        {order.side.toUpperCase()}
                                    </span>
                                    <span className="text-slate-400 text-xs uppercase">{order.type}</span>
                                </div>
                                <div className="text-right">
                                    {order.price && (
                                        <div className="text-white font-mono text-sm">@ {parseFloat(order.price).toFixed(4)}</div>
                                    )}
                                    {order.baseAmount && (
                                        <div className="text-slate-400 text-xs font-mono">{order.baseAmount} 单位</div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
