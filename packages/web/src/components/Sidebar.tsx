"use client";

import { LayoutDashboard, Settings, Activity, Wallet, Bot } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

const NAV_ITEMS = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/' },
    { icon: Bot, label: 'Bots', href: '/bots' },
    { icon: Activity, label: 'Analytics', href: '/analytics' },
    { icon: Wallet, label: 'Portfolio', href: '/portfolio' },
    { icon: Settings, label: 'Settings', href: '/settings' },
];

export function Sidebar() {
    const pathname = usePathname();

    return (
        <aside className="w-64 h-full bg-white flex flex-col border-r border-slate-100 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.03)] z-10">
            <div className="p-6 flex items-center gap-3">
                <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center">
                    <Bot className="w-5 h-5 text-white" />
                </div>
                <span className="font-bold text-slate-800 text-lg tracking-tight">StrategyHub</span>
            </div>

            <nav className="flex-1 px-4 py-6 space-y-1">
                {NAV_ITEMS.map((item) => {
                    const isActive = pathname === item.href ||
                        (item.href !== '/' && pathname.startsWith(item.href));
                    return (
                        <Link
                            key={item.label}
                            href={item.href}
                            className={clsx(
                                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group text-sm font-medium",
                                isActive
                                    ? "bg-teal-50 text-teal-600 shadow-sm"
                                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                            )}
                        >
                            <item.icon
                                className={clsx(
                                    "w-5 h-5 transition-colors",
                                    isActive ? "text-teal-600" : "text-slate-400 group-hover:text-slate-600"
                                )}
                            />
                            {item.label}
                        </Link>
                    );
                })}
            </nav>

            <div className="p-4 border-t border-slate-50">
                <div className="bg-slate-50 rounded-xl p-4 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-teal-400 to-cyan-500" />
                    <div className="flex-1">
                        <div className="text-xs font-bold text-slate-700">User</div>
                        <div className="text-[10px] text-slate-400">Pro Plan</div>
                    </div>
                </div>
            </div>
        </aside>
    );
}
