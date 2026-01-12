"use client";

import { Sidebar } from "@/components/Sidebar";
import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api";
import {
    Settings, Wallet, Plus, Trash2, Loader2, AlertCircle,
    CheckCircle, Shield, AlertTriangle
} from "lucide-react";
import clsx from "clsx";

interface Account {
    id: string;
    name: string;
    exchange: string;
    isTestnet: boolean;
    createdAt: string;
}

export default function SettingsAccountsPage() {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Create form state
    const [showCreate, setShowCreate] = useState(false);
    const [createLoading, setCreateLoading] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        exchange: 'binance',
        apiKey: '',
        secret: '',
        isTestnet: true,
    });

    // Delete confirmation
    const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const fetchAccounts = async () => {
        try {
            setIsLoading(true);
            const data = await api.accounts.list();
            setAccounts(data);
            setError(null);
        } catch (err: any) {
            setError(err.message || 'Failed to load accounts');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchAccounts();
    }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreateLoading(true);
        setCreateError(null);

        try {
            await api.accounts.create(formData);
            setShowCreate(false);
            setFormData({ name: '', exchange: 'binance', apiKey: '', secret: '', isTestnet: true });
            fetchAccounts();
        } catch (err: any) {
            setCreateError(err.message || 'Failed to create account');
        } finally {
            setCreateLoading(false);
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
            setDeleteError(err.message || 'Failed to delete account');
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
                                <h1 className="text-xl font-bold text-slate-800">Exchange Accounts</h1>
                                <p className="text-sm text-slate-400">Manage your exchange API connections</p>
                            </div>
                        </div>

                        <button
                            onClick={() => setShowCreate(true)}
                            className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-teal-500/20 transition-all"
                        >
                            <Plus className="w-4 h-4" />
                            Add Account
                        </button>
                    </div>
                </header>

                {/* Security Warning */}
                <div className="px-8 pt-6">
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                        <Shield className="w-5 h-5 text-amber-600 mt-0.5" />
                        <div>
                            <h4 className="font-bold text-amber-800 text-sm">V1 Security Notice</h4>
                            <p className="text-amber-700 text-xs mt-1">
                                Credentials are stored as plaintext in this version.
                                <strong> Only use testnet API keys.</strong> Mainnet accounts require encryption
                                (not yet enabled).
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
                            <p>No exchange accounts yet.</p>
                            <p className="text-sm mt-1">Click "Add Account" to connect your first exchange.</p>
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
                                            {account.isTestnet ? 'Testnet' : 'Mainnet'}
                                        </span>
                                    </div>

                                    <div className="text-xs text-slate-400 mb-4">
                                        Created: {new Date(account.createdAt).toLocaleDateString()}
                                    </div>

                                    <button
                                        onClick={() => setDeleteTarget(account)}
                                        className="w-full flex items-center justify-center gap-2 text-rose-500 hover:bg-rose-50 py-2 rounded-lg text-sm font-medium transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                        Delete
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>

            {/* Create Modal */}
            {showCreate && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                        <div className="p-6 border-b border-slate-100">
                            <h2 className="text-lg font-bold text-slate-800">Add Exchange Account</h2>
                        </div>

                        <form onSubmit={handleCreate} className="p-6 space-y-4">
                            {createError && (
                                <div className="bg-rose-50 text-rose-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4" />
                                    {createError}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g., My Testnet Account"
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Exchange</label>
                                <select
                                    value={formData.exchange}
                                    onChange={(e) => setFormData({ ...formData, exchange: e.target.value })}
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                                >
                                    <option value="binance">Binance</option>
                                    <option value="okx">OKX</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">API Key</label>
                                <input
                                    type="text"
                                    value={formData.apiKey}
                                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                                    placeholder="Enter API key"
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 font-mono text-sm"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Secret</label>
                                <input
                                    type="password"
                                    value={formData.secret}
                                    onChange={(e) => setFormData({ ...formData, secret: e.target.value })}
                                    placeholder="Enter secret key"
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 font-mono text-sm"
                                    required
                                />
                            </div>

                            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                                <input
                                    type="checkbox"
                                    id="isTestnet"
                                    checked={formData.isTestnet}
                                    onChange={(e) => setFormData({ ...formData, isTestnet: e.target.checked })}
                                    className="w-4 h-4 text-teal-600"
                                />
                                <label htmlFor="isTestnet" className="flex-1">
                                    <span className="text-sm font-medium text-slate-700">Testnet Account</span>
                                    <p className="text-xs text-slate-400">Mainnet accounts require encryption (not available in V1)</p>
                                </label>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowCreate(false)}
                                    className="flex-1 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 text-sm font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={createLoading}
                                    className="flex-1 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {createLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Create
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
                                    <h2 className="text-lg font-bold text-slate-800">Delete Account</h2>
                                    <p className="text-sm text-slate-400">This action cannot be undone</p>
                                </div>
                            </div>

                            <p className="text-sm text-slate-600 mb-4">
                                Are you sure you want to delete <strong>{deleteTarget.name}</strong>?
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
                                    Cancel
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={deleteLoading}
                                    className="flex-1 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {deleteLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
