"use client";

/**
 * 模板管理页面
 * 
 * 功能：
 * - 模板列表
 * - 创建/编辑模板
 * - 模板详情
 * - 应用模板到 Bot
 */

import { Sidebar } from "@/components/Sidebar";
import { useState, useEffect } from "react";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { api, ConfigTemplate } from "@/lib/api";
import {
    FileCode, Plus, Edit2, Trash2, Play, Loader2, AlertCircle,
    X, Save, Copy, Check, ChevronRight
} from "lucide-react";
import clsx from "clsx";

export default function TemplatesPage() {
    useRequireAuth();

    const [templates, setTemplates] = useState<ConfigTemplate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // 编辑/创建模式
    const [showEditor, setShowEditor] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<ConfigTemplate | null>(null);
    const [formName, setFormName] = useState("");
    const [formDescription, setFormDescription] = useState("");
    const [formConfig, setFormConfig] = useState("");
    const [saving, setSaving] = useState(false);

    // 详情面板
    const [selectedTemplate, setSelectedTemplate] = useState<ConfigTemplate | null>(null);

    // 应用模板
    const [showApply, setShowApply] = useState(false);
    const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null);
    const [bots, setBots] = useState<any[]>([]);
    const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
    const [applying, setApplying] = useState(false);

    // 复制成功提示
    const [copied, setCopied] = useState(false);

    // 加载模板
    useEffect(() => {
        loadTemplates();
    }, []);

    const loadTemplates = async () => {
        try {
            setIsLoading(true);
            const data = await api.templates.list();
            setTemplates(data);
            setError(null);
        } catch (err: any) {
            setError(err.message || "加载模板失败");
        } finally {
            setIsLoading(false);
        }
    };

    // 打开创建模态框
    const openCreate = () => {
        setEditingTemplate(null);
        setFormName("");
        setFormDescription("");
        setFormConfig(JSON.stringify({
            trigger: {
                basePriceType: "current",
                sellPercent: "2",
                buyPercent: "2"
            },
            trade: {
                quoteAmount: "100"
            },
            order: {
                orderType: "limit"
            },
            risk: {
                enableAutoClose: false
            }
        }, null, 2));
        setShowEditor(true);
    };

    // 打开编辑模态框
    const openEdit = (template: ConfigTemplate) => {
        setEditingTemplate(template);
        setFormName(template.name);
        setFormDescription(template.description || "");
        try {
            setFormConfig(JSON.stringify(JSON.parse(template.configJson), null, 2));
        } catch {
            setFormConfig(template.configJson);
        }
        setShowEditor(true);
    };

    // 保存模板
    const saveTemplate = async () => {
        if (!formName.trim() || !formConfig.trim()) return;

        // 验证 JSON
        try {
            JSON.parse(formConfig);
        } catch {
            setError("配置格式无效，请检查 JSON 格式");
            return;
        }

        setSaving(true);
        try {
            if (editingTemplate) {
                await api.templates.update(editingTemplate.id, {
                    name: formName,
                    description: formDescription || undefined,
                    configJson: formConfig
                });
            } else {
                await api.templates.create({
                    name: formName,
                    description: formDescription || undefined,
                    configJson: formConfig
                });
            }
            await loadTemplates();
            setShowEditor(false);
        } catch (err: any) {
            setError(err.message || "保存失败");
        } finally {
            setSaving(false);
        }
    };

    // 删除模板
    const deleteTemplate = async (id: string) => {
        if (!confirm("确定要删除此模板吗？")) return;

        try {
            await api.templates.delete(id);
            await loadTemplates();
            if (selectedTemplate?.id === id) {
                setSelectedTemplate(null);
            }
        } catch (err: any) {
            setError(err.message || "删除失败");
        }
    };

    // 打开应用模态框
    const openApply = async (templateId: string) => {
        setApplyTemplateId(templateId);
        setSelectedBotId(null);
        setShowApply(true);

        // 加载 Bot 列表
        try {
            const botList = await api.bots.list();
            setBots(botList);
        } catch (err: any) {
            setError(err.message || "加载 Bot 列表失败");
        }
    };

    // 应用模板
    const applyTemplate = async () => {
        if (!applyTemplateId || !selectedBotId) return;

        setApplying(true);
        try {
            await api.templates.apply(applyTemplateId, selectedBotId);
            setShowApply(false);
            // 显示成功提示
            alert("模板应用成功！");
        } catch (err: any) {
            setError(err.message || "应用失败");
        } finally {
            setApplying(false);
        }
    };

    // 复制配置
    const copyConfig = (config: string) => {
        navigator.clipboard.writeText(config);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="flex h-screen bg-page overflow-hidden">
            <Sidebar />

            <main className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Header */}
                <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-8 sticky top-0 z-30">
                    <div className="flex items-center gap-3">
                        <FileCode className="w-6 h-6 text-purple-600" />
                        <h1 className="text-xl font-bold text-slate-800">策略模板</h1>
                    </div>
                    <button
                        onClick={openCreate}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors shadow-lg shadow-purple-500/20"
                    >
                        <Plus className="w-4 h-4" />
                        创建模板
                    </button>
                </header>

                {/* Content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Template List */}
                    <div className="flex-1 overflow-y-auto p-8">
                        {isLoading ? (
                            <div className="flex items-center justify-center h-64">
                                <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
                            </div>
                        ) : error ? (
                            <div className="flex items-center justify-center h-64 text-rose-500 gap-2">
                                <AlertCircle className="w-6 h-6" />
                                <span>{error}</span>
                            </div>
                        ) : templates.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
                                <FileCode className="w-12 h-12 mb-4 opacity-50" />
                                <p className="font-medium">暂无模板</p>
                                <button
                                    onClick={openCreate}
                                    className="mt-4 text-purple-600 font-semibold hover:underline"
                                >
                                    创建第一个模板
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {templates.map(template => (
                                    <div
                                        key={template.id}
                                        onClick={() => setSelectedTemplate(template)}
                                        className={clsx(
                                            "bg-white rounded-2xl border shadow-sm p-6 cursor-pointer transition-all hover:-translate-y-1",
                                            selectedTemplate?.id === template.id
                                                ? "border-purple-300 ring-2 ring-purple-100"
                                                : "border-slate-100 hover:border-purple-200"
                                        )}
                                    >
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center">
                                                <FileCode className="w-5 h-5 text-purple-600" />
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); openEdit(template); }}
                                                    className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg"
                                                    title="编辑"
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); deleteTemplate(template.id); }}
                                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                                                    title="删除"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>

                                        <h3 className="font-bold text-slate-700 mb-1">{template.name}</h3>
                                        {template.description && (
                                            <p className="text-sm text-slate-400 mb-4 line-clamp-2">{template.description}</p>
                                        )}

                                        <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                                            <span className="text-xs text-slate-400">
                                                {new Date(template.updatedAt).toLocaleDateString()}
                                            </span>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); openApply(template.id); }}
                                                className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 font-medium"
                                            >
                                                <Play className="w-3 h-3" />
                                                应用
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Detail Panel */}
                    {selectedTemplate && (
                        <div className="w-96 bg-white border-l border-slate-100 flex flex-col">
                            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                                <h3 className="font-bold text-slate-800">模板详情</h3>
                                <button
                                    onClick={() => setSelectedTemplate(null)}
                                    className="p-1.5 hover:bg-slate-100 rounded-lg"
                                >
                                    <X className="w-4 h-4 text-slate-400" />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4">
                                <div className="mb-4">
                                    <div className="text-xs text-slate-400 mb-1">名称</div>
                                    <div className="font-medium text-slate-700">{selectedTemplate.name}</div>
                                </div>

                                {selectedTemplate.description && (
                                    <div className="mb-4">
                                        <div className="text-xs text-slate-400 mb-1">描述</div>
                                        <div className="text-sm text-slate-600">{selectedTemplate.description}</div>
                                    </div>
                                )}

                                <div className="mb-4">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs text-slate-400">配置</span>
                                        <button
                                            onClick={() => copyConfig(selectedTemplate.configJson)}
                                            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
                                        >
                                            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                                            {copied ? "已复制" : "复制"}
                                        </button>
                                    </div>
                                    <pre className="text-xs font-mono text-slate-600 bg-slate-50 p-4 rounded-xl overflow-x-auto max-h-96">
                                        {(() => {
                                            try {
                                                return JSON.stringify(JSON.parse(selectedTemplate.configJson), null, 2);
                                            } catch {
                                                return selectedTemplate.configJson;
                                            }
                                        })()}
                                    </pre>
                                </div>

                                <div className="text-xs text-slate-400">
                                    创建于 {new Date(selectedTemplate.createdAt).toLocaleString()}
                                </div>
                            </div>

                            <div className="p-4 border-t border-slate-100">
                                <button
                                    onClick={() => openApply(selectedTemplate.id)}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600"
                                >
                                    <Play className="w-4 h-4" />
                                    应用到 Bot
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* Editor Modal */}
            {showEditor && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-hidden">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="font-bold text-slate-800">
                                {editingTemplate ? "编辑模板" : "创建模板"}
                            </h2>
                            <button onClick={() => setShowEditor(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                                <X className="w-5 h-5 text-slate-400" />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto max-h-[70vh]">
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-slate-700 mb-1">模板名称</label>
                                <input
                                    type="text"
                                    value={formName}
                                    onChange={(e) => setFormName(e.target.value)}
                                    placeholder="例如：保守型网格策略"
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                                />
                            </div>

                            <div className="mb-4">
                                <label className="block text-sm font-medium text-slate-700 mb-1">描述（可选）</label>
                                <input
                                    type="text"
                                    value={formDescription}
                                    onChange={(e) => setFormDescription(e.target.value)}
                                    placeholder="简要描述此模板的用途"
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">配置 (JSON)</label>
                                <textarea
                                    value={formConfig}
                                    onChange={(e) => setFormConfig(e.target.value)}
                                    className="w-full h-80 px-4 py-3 border border-slate-200 rounded-xl font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                                />
                            </div>
                        </div>

                        <div className="p-4 border-t border-slate-100 flex justify-end gap-3">
                            <button
                                onClick={() => setShowEditor(false)}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                            >
                                取消
                            </button>
                            <button
                                onClick={saveTemplate}
                                disabled={saving || !formName.trim() || !formConfig.trim()}
                                className="flex items-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50"
                            >
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Apply Modal */}
            {showApply && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="font-bold text-slate-800">应用模板</h2>
                            <button onClick={() => setShowApply(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                                <X className="w-5 h-5 text-slate-400" />
                            </button>
                        </div>

                        <div className="p-4">
                            <p className="text-sm text-slate-500 mb-4">
                                选择要应用此模板的 Bot，应用后将覆盖 Bot 的当前配置。
                            </p>

                            {bots.length === 0 ? (
                                <div className="text-center py-8 text-slate-400">
                                    暂无可用的 Bot
                                </div>
                            ) : (
                                <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {bots.map(bot => (
                                        <div
                                            key={bot.id}
                                            onClick={() => setSelectedBotId(bot.id)}
                                            className={clsx(
                                                "p-3 rounded-lg border cursor-pointer transition-colors",
                                                selectedBotId === bot.id
                                                    ? "border-purple-300 bg-purple-50"
                                                    : "border-slate-100 hover:border-purple-200"
                                            )}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <div className="font-medium text-slate-700">{bot.symbol}</div>
                                                    <div className="text-xs text-slate-400">{bot.status}</div>
                                                </div>
                                                {selectedBotId === bot.id && (
                                                    <Check className="w-5 h-5 text-purple-600" />
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-100 flex justify-end gap-3">
                            <button
                                onClick={() => setShowApply(false)}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                            >
                                取消
                            </button>
                            <button
                                onClick={applyTemplate}
                                disabled={applying || !selectedBotId}
                                className="flex items-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50"
                            >
                                {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                应用
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
