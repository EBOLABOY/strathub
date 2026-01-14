"use client";

import { LayoutDashboard, Settings, Activity, Wallet, Bot, FileCode, Sliders } from 'lucide-react';
import clsx from 'clsx';
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { UserNav } from "@/components/UserNav";

const NAV_ITEMS = [
    { icon: LayoutDashboard, key: 'dashboard', href: '/' },
    { icon: Bot, key: 'bots', href: '/bots' },
    { icon: Activity, key: 'analytics', href: '/analytics' },
    { icon: Wallet, key: 'portfolio', href: '/portfolio' },
    { icon: Sliders, key: 'config', href: '/settings/config' },
    { icon: FileCode, key: 'templates', href: '/settings/templates' },
    { icon: Settings, key: 'settings', href: '/settings' },
];

export function Sidebar() {
    const t = useTranslations("nav");
    const tSidebar = useTranslations("sidebar");
    const tMeta = useTranslations("meta");
    const pathname = usePathname();

    return (
        <aside className="w-64 h-full bg-white flex flex-col border-r border-slate-100 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.03)] z-10">
            <div className="p-6 flex items-center gap-3">
                <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center">
                    <Bot className="w-5 h-5 text-white" />
                </div>
                <span className="font-bold text-slate-800 text-lg tracking-tight">{tMeta("title")}</span>
            </div>

            <nav className="flex-1 px-4 py-6 space-y-1">
                {NAV_ITEMS.map((item) => {
                    const isActive = pathname === item.href ||
                        (item.href !== '/' && pathname.startsWith(item.href));
                    return (
                        <Link
                            key={item.key}
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
                            {t(item.key)}
                        </Link>
                    );
                })}
            </nav>

            <div className="p-4 border-t border-slate-50">
                <UserNav />
            </div>
        </aside>
    );
}
