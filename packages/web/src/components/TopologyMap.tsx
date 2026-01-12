
"use client";

import { Bot, Layers, Server, Database, Globe } from 'lucide-react';

export function TopologyMap() {
    return (
        <div className="bg-white p-6 rounded-2xl shadow-diffuse border border-slate-50 h-[400px] relative overflow-hidden flex flex-col">
            <div className="flex justify-between items-center mb-4 z-10">
                <h3 className="text-lg font-bold text-slate-700">System Topology</h3>
                <div className="flex items-center gap-2">
                    <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span className="text-xs text-emerald-600 font-medium">System Online</span>
                </div>
            </div>

            <div className="flex-1 relative flex items-center justify-center">
                {/* SVG Edges */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                    <defs>
                        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#CBD5E1" stopOpacity="0.2" />
                            <stop offset="50%" stopColor="#0EA5E9" stopOpacity="0.5" />
                            <stop offset="100%" stopColor="#CBD5E1" stopOpacity="0.2" />
                        </linearGradient>
                    </defs>
                    {/* Lines connecting center to nodes */}
                    <line x1="50%" y1="50%" x2="20%" y2="30%" stroke="url(#lineGrad)" strokeWidth="2" strokeDasharray="4 4" className="animate-pulse" />
                    <line x1="50%" y1="50%" x2="80%" y2="30%" stroke="url(#lineGrad)" strokeWidth="2" strokeDasharray="4 4" className="animate-pulse" style={{ animationDelay: '0.5s' }} />
                    <line x1="50%" y1="50%" x2="20%" y2="70%" stroke="url(#lineGrad)" strokeWidth="2" strokeDasharray="4 4" className="animate-pulse" style={{ animationDelay: '1s' }} />
                    <line x1="50%" y1="50%" x2="80%" y2="70%" stroke="url(#lineGrad)" strokeWidth="2" strokeDasharray="4 4" className="animate-pulse" style={{ animationDelay: '1.5s' }} />
                </svg>

                {/* Center Node: Hub */}
                <div className="absolute z-20 flex flex-col items-center justify-center">
                    <div className="w-20 h-20 bg-white rounded-2xl shadow-lg border-2 border-teal-100 flex items-center justify-center relative">
                        <div className="absolute inset-0 bg-teal-50 rounded-2xl animate-pulse opacity-50"></div>
                        <Layers className="w-10 h-10 text-teal-600 relative z-10" />
                    </div>
                    <span className="mt-2 text-sm font-bold text-slate-700 bg-white/80 px-2 rounded-md backdrop-blur-sm">StrategyHub</span>
                </div>

                {/* Satellite Nodes */}
                {/* Top Left: Worker */}
                <div className="absolute top-[20%] left-[15%] flex flex-col items-center">
                    <div className="w-12 h-12 bg-white rounded-xl shadow-md border border-slate-100 flex items-center justify-center hover:scale-110 transition-transform cursor-pointer">
                        <Bot className="w-6 h-6 text-sky-500" />
                    </div>
                    <span className="mt-1 text-xs font-semibold text-slate-500">Workers</span>
                </div>

                {/* Top Right: Exchange */}
                <div className="absolute top-[20%] right-[15%] flex flex-col items-center">
                    <div className="w-12 h-12 bg-white rounded-xl shadow-md border border-slate-100 flex items-center justify-center hover:scale-110 transition-transform cursor-pointer">
                        <Globe className="w-6 h-6 text-indigo-500" />
                    </div>
                    <span className="mt-1 text-xs font-semibold text-slate-500">Binance</span>
                </div>

                {/* Bottom Left: DB */}
                <div className="absolute bottom-[20%] left-[15%] flex flex-col items-center">
                    <div className="w-12 h-12 bg-white rounded-xl shadow-md border border-slate-100 flex items-center justify-center hover:scale-110 transition-transform cursor-pointer">
                        <Database className="w-6 h-6 text-amber-500" />
                    </div>
                    <span className="mt-1 text-xs font-semibold text-slate-500">Database</span>
                </div>

                {/* Bottom Right: API */}
                <div className="absolute bottom-[20%] right-[15%] flex flex-col items-center">
                    <div className="w-12 h-12 bg-white rounded-xl shadow-md border border-slate-100 flex items-center justify-center hover:scale-110 transition-transform cursor-pointer">
                        <Server className="w-6 h-6 text-rose-500" />
                    </div>
                    <span className="mt-1 text-xs font-semibold text-slate-500">API Gateway</span>
                </div>

            </div>
        </div>
    );
}
