"use client";

import { Sidebar } from "@/components/Sidebar";
import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api";
import { FEATURED_EXCHANGES, isFeaturedExchange, supportsTestnet, type SupportedExchangeId } from "@crypto-strategy-hub/shared";
import {
    Settings, Wallet, Plus, Trash2, Pencil, Loader2, AlertCircle,
    CheckCircle, Shield, AlertTriangle
} from "lucide-react";
import clsx from "clsx";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { useTranslations } from "next-intl";

interface Account {
    id: string;
    name: string;
    exchange: string;
    isTestnet: boolean;
    createdAt: string;
}

export default function SettingsAccountsPage() {
    useRequireAuth();

    const t = useTranslations("accounts");
    const tApiErrors = useTranslations("apiErrors");

    const [accounts, setAccounts] = useState<Account[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Create/Edit form state
    const [formMode, setFormMode] = useState<"create" | "edit">("create");
    const [formOpen, setFormOpen] = useState(false);
    const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
    const [formLoading, setFormLoading] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        exchange: 'binance',
        apiKey: '',
        secret: '',
        passphrase: '',
        isTestnet: true,
    });

    // Delete confirmation
    const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const getApiErrorMessage = (err: unknown) => {
        if (err instanceof ApiError && err.code && tApiErrors.has(err.code as any)) {
            return tApiErrors(err.code as any);
        }
        return null;
    };

    const openCreate = () => {
        setFormMode("create");
        setEditingAccountId(null);
        setFormError(null);
        setFormData({ name: '', exchange: 'binance', apiKey: '', secret: '', passphrase: '', isTestnet: true });
        setFormOpen(true);
    };

    const openEdit = (account: Account) => {
        setFormMode("edit");
        setEditingAccountId(account.id);
        setFormError(null);
        setFormData({
            name: account.name,
            exchange: account.exchange.toLowerCase(),
            apiKey: "",
            secret: "",
            passphrase: "",
            isTestnet: account.isTestnet,
        });
        setFormOpen(true);
    };

    const closeForm = () => {
        setFormOpen(false);
        setFormError(null);
    };

    const fetchAccounts = async () => {
        try {
            setIsLoading(true);
            const data = await api.accounts.list();
            setAccounts(data);
            setError(null);
        } catch (err: any) {
            setError(getApiErrorMessage(err) ?? t("errors.load"));
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchAccounts();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormLoading(true);
        setFormError(null);

        try {
            if (formMode === "create") {
                const exchange = formData.exchange.toLowerCase();
                const apiKey = formData.apiKey.trim();
                const secret = formData.secret.trim();
                const passphrase = formData.passphrase.trim();

                if (exchange === "okx" && passphrase.length === 0) {
                    setFormError(t("errors.passphraseRequired"));
                    return;
                }

                await api.accounts.create({
                    name: formData.name,
                    exchange: exchange as SupportedExchangeId,
                    apiKey,
                    secret,
                    ...(exchange === "okx" && passphrase.length > 0 ? { passphrase } : {}),
                    isTestnet: supportsTestnet(exchange) ? formData.isTestnet : false,
                });
            } else {
                if (!editingAccountId) {
                    setFormError(t("errors.update"));
                    return;
                }

                const apiKey = formData.apiKey.trim();
                const secret = formData.secret.trim();
                const passphrase = formData.passphrase.trim();
                const updatingApiKeySecret = apiKey.length > 0 || secret.length > 0;

                if (updatingApiKeySecret && (apiKey.length === 0 || secret.length === 0)) {
                    setFormError(t("errors.credentialsPair"));
                    return;
                }

                await api.accounts.update(editingAccountId, {
                    name: formData.name,
                    isTestnet: formData.isTestnet,
                    ...(updatingApiKeySecret ? { apiKey, secret } : {}),
                    ...(passphrase.length > 0 ? { passphrase } : {}),
                });
            }

            closeForm();
            setEditingAccountId(null);
            setFormData({ name: '', exchange: 'binance', apiKey: '', secret: '', passphrase: '', isTestnet: true });
            await fetchAccounts();
        } catch (err: any) {
            setFormError(
                getApiErrorMessage(err) ??
                t(formMode === "create" ? "errors.create" : "errors.update")
            );
        } finally {
            setFormLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleteLoading(true);
        setDeleteError(null);

        try {
            await api.accounts.delete(deleteTarget.id);
            setDeleteTarget(null);
            fetchAccounts();
        } catch (err: any) {
            setDeleteError(getApiErrorMessage(err) ?? t("errors.delete"));
        } finally {
            setDeleteLoading(false);
        }
    };

    return (
        <div className="flex h-screen bg-page overflow-hidden">
            <Sidebar />

            <main className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Header */}
                <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 px-8 py-6 sticky top-0 z-30">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                                <Wallet className="w-5 h-5 text-slate-500" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-slate-800">{t("title")}</h1>
                                <p className="text-sm text-slate-400">{t("subtitle")}</p>
                            </div>
                        </div>

                        <button
                            onClick={openCreate}
                            className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-teal-500/20 transition-all"
                        >
                            <Plus className="w-4 h-4" />
                            {t("add")}
                        </button>
                    </div>
                </header>

                {/* Security Warning */}
                <div className="px-8 pt-6">
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                        <Shield className="w-5 h-5 text-amber-600 mt-0.5" />
                        <div>
                            <h4 className="font-bold text-amber-800 text-sm">{t("securityTitle")}</h4>
                            <p className="text-amber-700 text-xs mt-1">
                                {t("securityBody")}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-8">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
                        </div>
                    ) : error ? (
                        <div className="text-rose-500 flex items-center gap-2 justify-center py-12">
                            <AlertCircle className="w-5 h-5" />
                            {error}
                        </div>
                    ) : accounts.length === 0 ? (
                        <div className="text-center py-12 text-slate-400">
                            <Wallet className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>{t("emptyTitle")}</p>
                            <p className="text-sm mt-1">{t("emptySubtitle")}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {accounts.map((account) => (
                                <div
                                    key={account.id}
                                    className="bg-white rounded-2xl shadow-diffuse border border-slate-50 p-6 hover:shadow-lg transition-shadow"
                                >
                                    <div className="flex items-start justify-between mb-4">
                                        <div>
                                            <h3 className="font-bold text-slate-800">{account.name}</h3>
                                            <p className="text-sm text-slate-400 capitalize">{account.exchange}</p>
                                        </div>
                                        <span className={clsx(
                                            "px-2 py-1 rounded-full text-xs font-bold",
                                            account.isTestnet
                                                ? "bg-amber-100 text-amber-700"
                                                : "bg-emerald-100 text-emerald-700"
                                        )}>
                                            {account.isTestnet ? t("network.testnet") : t("network.mainnet")}
                                        </span>
                                    </div>

                                    <div className="text-xs text-slate-400 mb-4">
                                        {t("created", { date: new Date(account.createdAt).toLocaleDateString() })}
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => openEdit(account)}
                                            className="flex-1 flex items-center justify-center gap-2 text-slate-600 hover:bg-slate-50 py-2 rounded-lg text-sm font-medium transition-colors border border-slate-100"
                                        >
                                            <Pencil className="w-4 h-4" />
                                            {t("edit")}
                                        </button>
                                        <button
                                            onClick={() => setDeleteTarget(account)}
                                            className="flex-1 flex items-center justify-center gap-2 text-rose-500 hover:bg-rose-50 py-2 rounded-lg text-sm font-medium transition-colors border border-rose-100"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                            {t("delete")}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>

            {/* Create/Edit Modal */}
            {formOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                        <div className="p-6 border-b border-slate-100">
                            <h2 className="text-lg font-bold text-slate-800">
                                {formMode === "create" ? t("createModalTitle") : t("editModalTitle")}
                            </h2>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            {formError && (
                                <div className="bg-rose-50 text-rose-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4" />
                                    {formError}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">{t("fields.name")}</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder={t("placeholders.name")}
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">{t("fields.exchange")}</label>
                                <select
                                    value={formData.exchange}
                                    onChange={(e) => {
                                        const nextExchange = e.target.value;
                                        const canTestnet = supportsTestnet(nextExchange);
                                        setFormData({
                                            ...formData,
                                            exchange: nextExchange,
                                            isTestnet: canTestnet ? formData.isTestnet : false,
                                        });
                                    }}
                                    disabled={formMode === "edit"}
                                    className={clsx(
                                        "w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500",
                                        formMode === "edit" && "bg-slate-50 text-slate-500 cursor-not-allowed"
                                    )}
                                >
                                    {formMode === "edit" && !isFeaturedExchange(formData.exchange) && (
                                        <option value={formData.exchange}>{`${formData.exchange.toUpperCase()} (Legacy)`}</option>
                                    )}
                                    {FEATURED_EXCHANGES.map((id) => (
                                        <option key={id} value={id}>{t(`exchanges.${id}` as any)}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">{t("fields.apiKey")}</label>
                                <input
                                    type="text"
                                    value={formData.apiKey}
                                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                                    placeholder={t("placeholders.apiKey")}
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 font-mono text-sm"
                                    required={formMode === "create"}
                                />
                                {formMode === "edit" && (
                                    <p className="text-xs text-slate-400 mt-1">{t("editCredentialsHint")}</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">{t("fields.secret")}</label>
                                <input
                                    type="password"
                                    value={formData.secret}
                                    onChange={(e) => setFormData({ ...formData, secret: e.target.value })}
                                    placeholder={t("placeholders.secret")}
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 font-mono text-sm"
                                    required={formMode === "create"}
                                />
                            </div>

                            {formData.exchange.toLowerCase() === "okx" && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">{t("fields.passphrase")}</label>
                                    <input
                                        type="password"
                                        value={formData.passphrase}
                                        onChange={(e) => setFormData({ ...formData, passphrase: e.target.value })}
                                        placeholder={t("placeholders.passphrase")}
                                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 font-mono text-sm"
                                        required={formMode === "create"}
                                    />
                                    {formMode === "edit" && (
                                        <p className="text-xs text-slate-400 mt-1">{t("editPassphraseHint")}</p>
                                    )}
                                </div>
                            )}

                            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                                <input
                                    type="checkbox"
                                    id="isTestnet"
                                    checked={formData.isTestnet}
                                    disabled={formMode === "create" && !supportsTestnet(formData.exchange)}
                                    onChange={(e) => {
                                        const next = e.target.checked;
                                        if (next && !supportsTestnet(formData.exchange)) {
                                            setFormError(t("errors.testnetNotSupported"));
                                            return;
                                        }
                                        setFormData({ ...formData, isTestnet: next });
                                    }}
                                    className="w-4 h-4 text-teal-600"
                                />
                                <label htmlFor="isTestnet" className="flex-1">
                                    <span className="text-sm font-medium text-slate-700">{t("testnetLabel")}</span>
                                    <p className="text-xs text-slate-400">{t("testnetHint")}</p>
                                </label>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={closeForm}
                                    className="flex-1 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 text-sm font-medium"
                                >
                                    {t("cancel")}
                                </button>
                                <button
                                    type="submit"
                                    disabled={formLoading}
                                    className="flex-1 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {formLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {formMode === "create" ? t("create") : t("update")}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteTarget && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
                        <div className="p-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 bg-rose-100 rounded-full flex items-center justify-center">
                                    <AlertTriangle className="w-5 h-5 text-rose-600" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800">{t("deleteModalTitle")}</h2>
                                    <p className="text-sm text-slate-400">{t("deleteModalSubtitle")}</p>
                                </div>
                            </div>

                            <p className="text-sm text-slate-600 mb-4">
                                {t("deleteModalConfirm", { name: deleteTarget.name })}
                            </p>

                            {deleteError && (
                                <div className="bg-rose-50 text-rose-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2 mb-4">
                                    <AlertCircle className="w-4 h-4" />
                                    {deleteError}
                                </div>
                            )}

                            <div className="flex gap-3">
                                <button
                                    onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
                                    className="flex-1 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 text-sm font-medium"
                                >
                                    {t("cancel")}
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={deleteLoading}
                                    className="flex-1 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {deleteLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {t("delete")}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
