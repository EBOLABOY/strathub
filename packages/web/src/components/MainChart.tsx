
"use client";

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

const DATA = [
    { name: 'Mon', value: 4000 },
    { name: 'Tue', value: 3000 },
    { name: 'Wed', value: 2000 },
    { name: 'Thu', value: 2780 },
    { name: 'Fri', value: 1890 },
    { name: 'Sat', value: 2390 },
    { name: 'Sun', value: 3490 },
    { name: 'Mon2', value: 4200 },
    { name: 'Tue2', value: 3800 },
    { name: 'Wed2', value: 5000 },
    { name: 'Thu2', value: 4800 },
];

export function MainChart() {
    return (
        <div className="bg-white p-6 rounded-2xl shadow-diffuse border border-slate-50 h-[400px] flex flex-col">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-lg font-bold text-slate-700">Portfolio Performance</h3>
                    <p className="text-sm text-slate-400">Net Asset Value (NAV) over time</p>
                </div>
                <div className="flex gap-2">
                    {['1H', '1D', '1W', '1M', '1Y'].map(pd => (
                        <button key={pd} className="px-3 py-1 text-xs font-medium text-slate-500 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors">
                            {pd}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 w-full min-h-0">
                <ResponsiveContainer
                    width="100%"
                    height="100%"
                    initialDimension={{ width: 1, height: 1 }}
                    minWidth={1}
                    minHeight={1}
                >
                    <AreaChart data={DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
            </div>
        </div>
    );
}
