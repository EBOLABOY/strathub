"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
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

    const handleCreateAccount = async () => {
        setIsLoading(true);
        setError(null);

        if (!email || !password) {
            setError(t("errors.emailPasswordRequired"));
            setIsLoading(false);
            return;
        }

        try {
            try {
                await api.auth.register(email, password);
            } catch (err: any) {
                if (!(err instanceof ApiError) || err.code !== "EMAIL_EXISTS") {
                    throw err;
                }
            }

            const { token } = await api.auth.login(email, password);
            finishLogin(token);
        } catch (err: any) {
            setError(getApiErrorMessage(err) ?? t("errors.failedConnect"));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-page">
            <div className="bg-white p-8 rounded-2xl shadow-diffuse border border-slate-50 w-full max-w-md">
                <div className="flex flex-col items-center mb-8">
                    <div className="w-12 h-12 bg-teal-500 rounded-xl flex items-center justify-center mb-3 shadow-lg shadow-teal-500/20">
                        <Bot className="w-7 h-7 text-white" />
                    </div>
                    <h1 className="text-xl font-bold text-slate-800">{t("title")}</h1>
                    <p className="text-sm text-slate-400">{t("subtitle", { brand: tMeta("title") })}</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                    {error && (
                        <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg flex items-center gap-2 text-sm text-rose-600">
                            <AlertCircle className="w-4 h-4" />
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                            {t("email")}
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all text-sm font-medium text-slate-700 bg-slate-50 focus:bg-white"
                            placeholder={t("placeholders.email")}
                            autoComplete="email"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                            {t("password")}
                        </label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all text-sm font-medium text-slate-700 bg-slate-50 focus:bg-white"
                            placeholder={t("placeholders.password")}
                            autoComplete="current-password"
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-slate-800/20 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed mt-2"
                    >
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("signIn")}
                    </button>

                    <button
                        type="button"
                        disabled={isLoading}
                        onClick={handleCreateAccount}
                        className="w-full bg-white hover:bg-slate-50 text-slate-700 font-bold py-3 rounded-xl transition-all border border-slate-200 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                        {isLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            t("createAccount")
                        )}
                    </button>

                    <div className="text-center mt-4">
                        <a href="#" className="text-xs font-medium text-teal-600 hover:text-teal-700">
                            {t("detailedInstructions")}
                        </a>
                    </div>
                </form>
            </div>
        </div>
    );
}
