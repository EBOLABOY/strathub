"use client";

import { useState } from "react";
import { useRouter, Link } from "@/i18n/navigation";
import { api, ApiError } from "@/lib/api";
import { Bot, Loader2, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

export default function LoginPage() {
    const t = useTranslations("login");
    const tApiErrors = useTranslations("apiErrors");
    const tMeta = useTranslations("meta");
    const router = useRouter();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const getApiErrorMessage = (err: unknown) => {
        if (err instanceof ApiError && err.code && tApiErrors.has(err.code as any)) {
            return tApiErrors(err.code as any);
        }
        return null;
    };

    const finishLogin = (token: string) => {
        localStorage.setItem("token", token);

        const returnTo = new URLSearchParams(window.location.search).get("returnTo");
        router.push(returnTo?.startsWith("/") ? returnTo : "/");
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            const { token } = await api.auth.login(email, password);
            finishLogin(token);
        } catch (err: any) {
            setError(getApiErrorMessage(err) ?? t("errors.failedConnect"));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 relative overflow-hidden font-sans">
            {/* Ambient Background Effects */}
            <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-teal-500/20 rounded-full blur-[120px] pointer-events-none mix-blend-screen opacity-50" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none mix-blend-screen opacity-50" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-slate-900/50 rounded-full blur-3xl pointer-events-none" />

            <div className="flex flex-col items-center w-full max-w-sm px-4 relative z-10">
                {/* Logo & Header */}
                <div className="flex flex-col items-center mb-10 text-center animate-in fade-in slide-in-from-top-4 duration-700">
                    <div className="w-16 h-16 bg-gradient-to-tr from-teal-400 to-cyan-500 rounded-2xl flex items-center justify-center mb-6 shadow-2xl shadow-teal-500/20 ring-1 ring-white/20">
                        <Bot className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">{t("title")}</h1>
                    <p className="text-slate-400 text-sm font-medium">{t("subtitle", { brand: tMeta("title") })}</p>
                </div>

                {/* Glass Card */}
                <div className="w-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-1 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
                    <div className="bg-slate-950/50 rounded-[20px] p-7 border border-white/5">
                        <form onSubmit={handleLogin} className="space-y-5">
                            {error && (
                                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-2 text-sm text-rose-400 font-medium animate-in fade-in zoom-in-95">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                    {error}
                                </div>
                            )}

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider ml-1">
                                        {t("email")}
                                    </label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl border border-white/10 bg-white/5 focus:bg-white/10 focus:border-teal-500/50 focus:ring-4 focus:ring-teal-500/10 outline-none transition-all text-sm font-medium text-white placeholder:text-slate-600"
                                        placeholder={t("placeholders.email") || "name@example.com"}
                                        autoComplete="email"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider ml-1">
                                        {t("password")}
                                    </label>
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl border border-white/10 bg-white/5 focus:bg-white/10 focus:border-teal-500/50 focus:ring-4 focus:ring-teal-500/10 outline-none transition-all text-sm font-medium text-white placeholder:text-slate-600"
                                        placeholder={t("placeholders.password")}
                                        autoComplete="current-password"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="pt-2">
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-400 hover:to-cyan-400 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-teal-500/20 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed transform hover:-translate-y-0.5"
                                >
                                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : t("signIn")}
                                </button>
                            </div>

                            <div className="text-center pt-2">
                                <span className="text-slate-500 text-sm">{t("noAccount")} </span>
                                <Link href="/register" className="text-teal-500 hover:text-teal-400 font-bold text-sm transition-colors ml-1">
                                    {t("registerLink")}
                                </Link>
                            </div>

                            <div className="text-center pt-2 border-t border-white/5 mt-4">
                                <a href="#" className="text-xs font-medium text-slate-600 hover:text-slate-500 transition-colors">
                                    {t("detailedInstructions")}
                                </a>
                            </div>
                        </form>
                    </div>
                </div>

                {/* Footer copyright or discreet text */}
                <div className="mt-8 text-xs text-slate-600 font-medium">
                    &copy; 2026 {tMeta("title")} Inc.
                </div>
            </div>
        </div>
    );
}
