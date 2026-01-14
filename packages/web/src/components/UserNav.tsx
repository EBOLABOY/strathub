"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { LogOut, Globe, ChevronUp } from 'lucide-react';
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { getPathname, usePathname } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import clsx from 'clsx';

function setLocaleCookie(locale: AppLocale) {
    document.cookie = `NEXT_LOCALE=${locale};path=/;SameSite=Lax`;
}

export function UserNav() {
    const tSidebar = useTranslations("sidebar");
    const tLang = useTranslations("language");
    const locale = useLocale() as AppLocale;
    const pathname = usePathname();
    const router = useRouter();

    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const toggleLang = useCallback(() => {
        const nextLocale = locale === 'zh' ? 'en' : 'zh';
        setLocaleCookie(nextLocale);

        const nextPathname = getPathname({
            href: pathname,
            locale: nextLocale,
            forcePrefix: nextLocale !== routing.defaultLocale,
        });

        const suffix = `${window.location.search}${window.location.hash}`;
        router.replace(`${nextPathname}${suffix}`);
        setIsOpen(false);
    }, [locale, pathname, router]);

    const handleLogout = () => {
        localStorage.removeItem("token");
        window.location.href = "/login";
    };

    return (
        <div className="relative" ref={menuRef}>
            {/* Variable Z-Index to popup over layout */}
            {isOpen && (
                <div className="absolute bottom-full left-0 w-full mb-3 bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 py-1 overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-200 z-50">
                    <div className="px-4 py-2 border-b border-slate-50 mb-1 bg-slate-50/50">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Settings</span>
                    </div>

                    <div className="p-1">
                        <button
                            onClick={toggleLang}
                            className="w-full text-left px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-teal-600 flex items-center gap-3 transition-colors rounded-xl group"
                        >
                            <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center text-teal-600 group-hover:bg-teal-100 transition-colors">
                                <Globe className="w-4 h-4" />
                            </div>
                            <span className="flex-1">{tLang("label")}</span>
                            <span className="text-xs font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-500 border border-slate-200">
                                {locale === 'zh' ? 'EN' : '中'}
                            </span>
                        </button>

                        <button
                            onClick={handleLogout}
                            className="w-full text-left px-3 py-2 text-sm font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-600 flex items-center gap-3 transition-colors rounded-xl mt-1 group"
                        >
                            <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center text-rose-500 group-hover:bg-rose-100 transition-colors">
                                <LogOut className="w-4 h-4" />
                            </div>
                            {tSidebar("logout")}
                        </button>
                    </div>
                </div>
            )}

            {/* Trigger Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={clsx(
                    "w-full flex items-center gap-3 p-3 rounded-2xl transition-all duration-200 border text-left",
                    isOpen
                        ? "bg-white border-teal-500 ring-2 ring-teal-500/10 shadow-lg"
                        : "bg-slate-50 border-transparent hover:bg-slate-100 hover:border-slate-200"
                )}
            >
                <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-teal-400 to-cyan-500 shadow-sm flex-shrink-0 border-2 border-white ring-1 ring-slate-100" />
                <div className="flex-1 overflow-hidden">
                    <div className="text-sm font-bold text-slate-700 truncate leading-tight">{tSidebar("user")}</div>
                    <div className="text-[11px] font-medium text-slate-400 truncate leading-tight mt-0.5">{tSidebar("plan")}</div>
                </div>
                <ChevronUp className={clsx("w-4 h-4 text-slate-400 transition-transform duration-200", isOpen && "rotate-180")} />
            </button>
        </div>
    );
}
