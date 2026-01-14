"use client";

/**
 * 策略模板管理页面
 */

import { Sidebar } from "@/components/Sidebar";
import { useState, useEffect } from "react";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { api, ConfigTemplate } from "@/lib/api";
import {
    FileCode, Plus, Edit2, Trash2, Play, Loader2, AlertCircle, X, Save, Copy, Check, ChevronRight
} from "lucide-react";
import clsx from "clsx";

export default function TemplatesPage() {
    useRequireAuth();

    const [templates, setTemplates] = useState<ConfigTemplate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedTemplate, setSelectedTemplate] = useState<ConfigTemplate | null>(null);
    const [showEditor, setShowEditor] = useState(false);
    const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
    const [formData, setFormData] = useState({ name: '', description: '', configJson: '' });
    const [saving, setSaving] = useState(false);
    const [showApply, setShowApply] = useState(false);
    const [applyBotId, setApplyBotId] = useState('');
    const [applying, setApplying] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => { loadTemplates(); }, []);

    const loadTemplates = async () => {
        try {
            setIsLoading(true);
            const data = await api.templates.list();
            setTemplates(data);
            setError(null);
        } catch (err: any) { setError(err.message || "加载模板失败"); }
        finally { setIsLoading(false); }
    };

    const openCreate = () => {
        setEditorMode('create');
        setFormData({ name: '', description: '', configJson: JSON.stringify({ trigger: { basePriceType: 'current', sellPercent: '2', buyPercent: '2' }, trade: { quoteAmount: '100' } }, null, 2) });
        setShowEditor(true);
    };

    const openEdit = (template: ConfigTemplate) => {
        setEditorMode('edit');
        setFormData({ name: template.name, description: template.description || '', configJson: template.configJson });
        setSelectedTemplate(template);
        setShowEditor(true);
    };

    const saveTemplate = async () => {
        setSaving(true);
        try {
            if (editorMode === 'create') {
                await api.templates.create({ name: formData.name, description: formData.description, configJson: formData.configJson });
            } else if (selectedTemplate) {
                await api.templates.update(selectedTemplate.id, { name: formData.name, description: formData.description, configJson: formData.configJson });
            }
            await loadTemplates();
            setShowEditor(false);
        } catch (err: any) { setError(err.message || "保存失败"); }
        finally { setSaving(false); }
    };

    const deleteTemplate = async (id: string) => {
        if (!confirm('确定要删除此模板吗？')) return;
        try {
            await api.templates.delete(id);
            await loadTemplates();
            if (selectedTemplate?.id === id) setSelectedTemplate(null);
        } catch (err: any) { setError(err.message || "删除失败"); }
    };

    const applyTemplate = async () => {
        if (!selectedTemplate || !applyBotId) return;
        setApplying(true);
        try {
            await api.templates.apply(selectedTemplate.id, applyBotId);
            setShowApply(false);
            setApplyBotId('');
        } catch (err: any) { setError(err.message || "应用失败"); }
        finally { setApplying(false); }
    };

    const copyConfig = () => {
        if (selectedTemplate) {
            navigator.clipboard.writeText(selectedTemplate.configJson);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="flex h-screen bg-page overflow-hidden">
            <Sidebar />
            <main className="flex-1 flex flex-col h-full overflow-hidden">
                <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-8 sticky top-0 z-30">
                    <div className="flex items-center gap-3">
                        <FileCode className="w-6 h-6 text-indigo-600" />
                        <h1 className="text-xl font-bold text-slate-800">策略模板</h1>
                    </div>
                    <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors">
                        <Plus className="w-4 h-4" /> 创建模板
                    </button>
                </header>

                <div className="flex-1 flex overflow-hidden">
                    <div className="flex-1 overflow-y-auto p-8">
                        {isLoading ? (
                            <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
                        ) : error ? (
                            <div className="flex items-center justify-center h-64 text-rose-500 gap-2"><AlertCircle className="w-6 h-6" /><span>{error}</span></div>
                        ) : templates.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                                <FileCode className="w-12 h-12 mb-4 opacity-50" />
                                <p className="mb-4">暂无策略模板</p>
                                <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600"><Plus className="w-4 h-4" /> 创建第一个模板</button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {templates.map(template => (
                                    <div key={template.id} onClick={() => setSelectedTemplate(template)}
                                        className={clsx("bg-white rounded-xl border shadow-sm p-4 cursor-pointer transition-all hover:shadow-md",
                                            selectedTemplate?.id === template.id ? "border-indigo-300 ring-2 ring-indigo-100" : "border-slate-100")}>
                                        <div className="flex items-start justify-between mb-2">
                                            <h3 className="font-bold text-slate-800 truncate">{template.name}</h3>
                                            <div className="flex items-center gap-1">
                                                <button onClick={(e) => { e.stopPropagation(); openEdit(template); }} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"><Edit2 className="w-3.5 h-3.5" /></button>
                                                <button onClick={(e) => { e.stopPropagation(); deleteTemplate(template.id); }} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                                            </div>
                                        </div>
                                        {template.description && <p className="text-xs text-slate-400 mb-3 line-clamp-2">{template.description}</p>}
                                        <div className="flex items-center justify-between text-xs text-slate-400">
                                            <span>更新于 {new Date(template.updatedAt).toLocaleDateString()}</span>
                                            <ChevronRight className="w-4 h-4" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {selectedTemplate && (
                        <div className="w-96 bg-white border-l border-slate-100 flex flex-col">
                            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                                <h2 className="font-bold text-slate-800 truncate">{selectedTemplate.name}</h2>
                                <button onClick={() => setSelectedTemplate(null)} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4 text-slate-400" /></button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4">
                                {selectedTemplate.description && <p className="text-sm text-slate-500 mb-4">{selectedTemplate.description}</p>}
                                <div className="mb-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-medium text-slate-500">配置内容</span>
                                        <button onClick={copyConfig} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700">
                                            {copied ? <><Check className="w-3 h-3" /> 已复制</> : <><Copy className="w-3 h-3" /> 复制</>}
                                        </button>
                                    </div>
                                    <pre className="bg-slate-50 rounded-lg p-3 text-xs font-mono text-slate-600 overflow-x-auto max-h-64">{JSON.stringify(JSON.parse(selectedTemplate.configJson), null, 2)}</pre>
                                </div>
                            </div>
                            <div className="p-4 border-t border-slate-100">
                                <button onClick={() => setShowApply(true)} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600">
                                    <Play className="w-4 h-4" /> 应用到 Bot
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {showEditor && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="font-bold text-slate-800">{editorMode === 'create' ? '创建模板' : '编辑模板'}</h2>
                            <button onClick={() => setShowEditor(false)} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-400" /></button>
                        </div>
                        <div className="p-4 space-y-4 overflow-y-auto max-h-[60vh]">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">模板名称</label>
                                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500" placeholder="例如：保守型网格" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">描述</label>
                                <input type="text" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500" placeholder="简要描述此模板的用途" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">配置 JSON</label>
                                <textarea value={formData.configJson} onChange={(e) => setFormData({ ...formData, configJson: e.target.value })}
                                    className="w-full h-48 px-4 py-3 border border-slate-200 rounded-lg font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500" />
                            </div>
                        </div>
                        <div className="p-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={() => setShowEditor(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
                            <button onClick={saveTemplate} disabled={saving || !formData.name.trim() || !formData.configJson.trim()}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 保存
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showApply && selectedTemplate && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="font-bold text-slate-800">应用模板到 Bot</h2>
                            <button onClick={() => setShowApply(false)} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-400" /></button>
                        </div>
                        <div className="p-4">
                            <p className="text-sm text-slate-500 mb-4">将模板 <strong>{selectedTemplate.name}</strong> 的配置应用到指定 Bot。仅支持 DRAFT 或 STOPPED 状态的 Bot。</p>
                            <input type="text" value={applyBotId} onChange={(e) => setApplyBotId(e.target.value)}
                                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500" placeholder="输入 Bot ID" />
                        </div>
                        <div className="p-4 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={() => setShowApply(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
                            <button onClick={applyTemplate} disabled={applying || !applyBotId.trim()}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50">
                                {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} 应用
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
