"use client";

/**
 * 配置中心页面
 */

import { Sidebar } from "@/components/Sidebar";
import { useState, useEffect } from "react";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { api, ConfigItem, ConfigHistory } from "@/lib/api";
import {
    Settings, Search, Filter, Download, Upload, History, RotateCcw,
    Edit2, Save, X, Loader2, AlertCircle
} from "lucide-react";
import clsx from "clsx";

const CATEGORIES = [
    { key: 'all', label: '全部', color: 'slate' },
    { key: 'trading', label: '交易', color: 'emerald' },
    { key: 'risk', label: '风控', color: 'rose' },
    { key: 'notification', label: '通知', color: 'blue' },
    { key: 'system', label: '系统', color: 'purple' },
];

export default function ConfigPage() {
    useRequireAuth();

    const [configs, setConfigs] = useState<ConfigItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("all");
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");
    const [saving, setSaving] = useState(false);
    const [historyKey, setHistoryKey] = useState<string | null>(null);
    const [history, setHistory] = useState<ConfigHistory[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [importText, setImportText] = useState("");
    const [importing, setImporting] = useState(false);

    useEffect(() => { loadConfigs(); }, []);

    const loadConfigs = async () => {
        try {
            setIsLoading(true);
            const data = await api.config.list();
            setConfigs(data);
            setError(null);
        } catch (err: any) {
            setError(err.message || "加载配置失败");
        } finally {
            setIsLoading(false);
        }
    };

    const filteredConfigs = configs.filter(config => {
        const matchesSearch = config.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
            config.description?.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === "all" || config.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    const startEdit = (config: ConfigItem) => { setEditingKey(config.key); setEditValue(config.value); };

    const saveEdit = async () => {
        if (!editingKey) return;
        setSaving(true);
        try {
            await api.config.update(editingKey, editValue);
            await loadConfigs();
            setEditingKey(null);
        } catch (err: any) { setError(err.message || "保存失败"); }
        finally { setSaving(false); }
    };

    const viewHistory = async (key: string) => {
        setHistoryKey(key);
        setHistoryLoading(true);
        try {
            const data = await api.config.getHistory(key);
            setHistory(data);
        } catch (err: any) { setError(err.message || "加载历史失败"); }
        finally { setHistoryLoading(false); }
    };

    const rollback = async (historyId: string) => {
        if (!historyKey) return;
        try {
            await api.config.rollback(historyKey, historyId);
            await loadConfigs();
            setHistoryKey(null);
        } catch (err: any) { setError(err.message || "回滚失败"); }
    };

    const exportConfigs = async () => {
        try {
            const data = await api.config.export();
            const blob = new Blob([JSON.stringify(data.configs, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `config-export-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err: any) { setError(err.message || "导出失败"); }
    };

    const importConfigs = async () => {
        setImporting(true);
        try {
            const configs = JSON.parse(importText);
            await api.config.import(configs);
            await loadConfigs();
            setShowImport(false);
            setImportText("");
        } catch (err: any) { setError(err.message || "导入失败"); }
        finally { setImporting(false); }
    };

    return (
        <div className="flex h-screen bg-page overflow-hidden">
            <Sidebar />
            <main className="flex-1 flex flex-col h-full overflow-hidden">
                <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-8 sticky top-0 z-30">
                    <div className="flex items-center gap-3">
                        <Settings className="w-6 h-6 text-teal-600" />
                        <h1 className="text-xl font-bold text-slate-800">配置中心</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={exportConfigs} className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">
                            <Download className="w-4 h-4" /> 导出
                        </button>
                        <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">
                            <Upload className="w-4 h-4" /> 导入
                        </button>
                    </div>
                </header>

                <div className="px-8 py-4 bg-white border-b border-slate-100 flex items-center gap-4">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input type="text" placeholder="搜索配置..." value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
                    </div>
                    <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-slate-400" />
                        {CATEGORIES.map(cat => (
                            <button key={cat.key} onClick={() => setSelectedCategory(cat.key)}
                                className={clsx("px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                                    selectedCategory === cat.key ? "bg-teal-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
                                {cat.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-8">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>
                    ) : error ? (
                        <div className="flex items-center justify-center h-64 text-rose-500 gap-2"><AlertCircle className="w-6 h-6" /><span>{error}</span></div>
                    ) : filteredConfigs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-slate-400"><Settings className="w-12 h-12 mb-4 opacity-50" /><p>暂无配置</p></div>
                    ) : (
                        <div className="space-y-3">
                            {filteredConfigs.map(config => (
                                <div key={config.key} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                                    <div className="p-4 flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="font-mono text-sm font-bold text-slate-700">{config.key}</span>
                                                <span className={clsx("px-2 py-0.5 rounded-full text-xs",
                                                    config.category === 'trading' && "bg-emerald-50 text-emerald-600",
                                                    config.category === 'risk' && "bg-rose-50 text-rose-600",
                                                    config.category === 'notification' && "bg-blue-50 text-blue-600",
                                                    config.category === 'system' && "bg-purple-50 text-purple-600",
                                                    !['trading', 'risk', 'notification', 'system'].includes(config.category) && "bg-slate-50 text-slate-600"
                                                )}>{config.category}</span>
                                            </div>
                                            {config.description && <p className="text-xs text-slate-400 mb-2">{config.description}</p>}
                                            {editingKey === config.key ? (
                                                <div className="flex items-center gap-2">
                                                    <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)}
                                                        className="flex-1 px-3 py-2 border border-teal-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/20" autoFocus />
                                                    <button onClick={saveEdit} disabled={saving} className="p-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 disabled:opacity-50">
                                                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                                    </button>
                                                    <button onClick={() => setEditingKey(null)} className="p-2 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                                                </div>
                                            ) : (
                                                <div className="font-mono text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-lg">{config.value}</div>
                                            )}
                                        </div>
                                        {editingKey !== config.key && (
                                            <div className="flex items-center gap-1 ml-4">
                                                <button onClick={() => startEdit(config)} className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg" title="编辑"><Edit2 className="w-4 h-4" /></button>
                                                <button onClick={() => viewHistory(config.key)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="历史"><History className="w-4 h-4" /></button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>

            {historyKey && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-2"><History className="w-5 h-5 text-blue-600" /><h2 className="font-bold text-slate-800">历史版本</h2><span className="font-mono text-sm text-slate-400">{historyKey}</span></div>
                            <button onClick={() => setHistoryKey(null)} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-400" /></button>
                        </div>
                        <div className="p-4 overflow-y-auto max-h-[60vh]">
                            {historyLoading ? (<div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
                            ) : history.length === 0 ? (<div className="text-center py-8 text-slate-400">暂无历史记录</div>
                            ) : (
                                <div className="space-y-3">
                                    {history.map((h, i) => (
                                        <div key={h.id} className="border border-slate-100 rounded-lg p-4">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs text-slate-400">{new Date(h.changedAt).toLocaleString()}</span>
                                                {i !== 0 && (<button onClick={() => rollback(h.id)} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"><RotateCcw className="w-3 h-3" />回滚到此版本</button>)}
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div><div className="text-xs text-slate-400 mb-1">旧值</div><div className="font-mono text-sm bg-rose-50 text-rose-700 px-2 py-1 rounded">{h.oldValue}</div></div>
                                                <div><div className="text-xs text-slate-400 mb-1">新值</div><div className="font-mono text-sm bg-emerald-50 text-emerald-700 px-2 py-1 rounded">{h.newValue}</div></div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {showImport && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-2"><Upload className="w-5 h-5 text-teal-600" /><h2 className="font-bold text-slate-800">导入配置</h2></div>
                            <button onClick={() => setShowImport(false)} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-400" /></button>
                        </div>
                        <div className="p-4">
                            <p className="text-sm text-slate-500 mb-4">粘贴 JSON 格式的配置数据</p>
                            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='[{"key": "MAX_BOTS", "value": "10"}]'
                                className="w-full h-48 px-4 py-3 border border-slate-200 rounded-xl font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
                        </div>
                        <div className="p-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={() => setShowImport(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
                            <button onClick={importConfigs} disabled={importing || !importText.trim()} className="flex items-center gap-2 px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 disabled:opacity-50">
                                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} 导入
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
