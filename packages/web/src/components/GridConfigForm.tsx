import { useState } from "react";
import { useTranslations } from "next-intl";
import { clsx } from "clsx";
import {
    HelpCircle, Settings, Zap, Clock, AlertTriangle,
    TrendingUp, TrendingDown, Lock, Unlock, ChevronDown,
    ChevronUp, RotateCcw, Activity
} from "lucide-react";

interface GridConfigFormProps {
    configJson: string;
    onChange: (newConfigJson: string) => void;
}

// 内部表单状态 (保持逻辑一致)
interface FormState {
    basePriceType: 'current' | 'manual';
    basePrice: string;
    gridType: 'percent' | 'price';
    isSymmetric: boolean;
    riseSell: string;
    fallBuy: string;
    enablePullback: boolean;
    pullbackPercent: string;
    enableRebound: boolean;
    reboundPercent: string;
    floorPrice: string;
    priceMax: string;
    expirationDays: string;
    orderType: 'limit' | 'market';
    entryPriceSource: 'trigger' | 'orderbook';
    entryBookLevel: string;
    amountMode: 'amount' | 'percent';
    gridCount: string;
    amountPerGrid: string;
    maxPositionPercent: string;
    enableExpires: boolean;
}

// ------ UI Components ------

function SectionHeader({ icon: Icon, title, subtitle }: { icon: any, title: string, subtitle?: string }) {
    return (
        <div className="flex items-center gap-2 mb-4">
            <div className="p-1.5 bg-slate-100 rounded-lg text-slate-600">
                <Icon className="w-4 h-4" />
            </div>
            <div>
                <h3 className="text-sm font-bold text-slate-800 leading-none">{title}</h3>
                {subtitle && <p className="text-xs text-slate-400 font-medium mt-0.5">{subtitle}</p>}
            </div>
        </div>
    );
}

function InputGroup({ label, suffix, children, className }: { label?: string, suffix?: string, children: React.ReactNode, className?: string }) {
    return (
        <div className={className}>
            {label && <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">{label}</label>}
            <div className="relative group">
                {children}
                {suffix && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 group-focus-within:text-slate-600 transition-colors">
                        {suffix}
                    </span>
                )}
            </div>
        </div>
    );
}

function CleanInput({ value, onChange, placeholder, disabled }: { value: string, onChange: (v: string) => void, placeholder?: string, disabled?: boolean }) {
    return (
        <input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder={placeholder}
            className={clsx(
                "w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono font-medium text-slate-700 outline-none transition-all",
                "focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500",
                "disabled:opacity-60 disabled:cursor-not-allowed"
            )}
            step="any"
        />
    );
}

function ToggleButton({ active, label, onClick }: { active: boolean, label: string, onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={clsx(
                "px-3 py-1.5 rounded-md text-xs font-bold transition-all border",
                active
                    ? "bg-slate-800 text-white border-slate-800 shadow-sm"
                    : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
            )}
        >
            {label}
        </button>
    );
}

function Switch({ checked, onChange, disabled }: { checked: boolean, onChange: (v: boolean) => void, disabled?: boolean }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onChange(!checked)}
            className={clsx(
                "w-9 h-5 rounded-full relative transition-colors duration-200 focus:outline-none",
                checked ? "bg-indigo-600" : "bg-slate-200",
                disabled && "opacity-50 cursor-not-allowed"
            )}
        >
            <div className={clsx(
                "w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 left-0.5 shadow-sm transition-transform duration-200",
                checked ? "translate-x-4" : "translate-x-0"
            )} />
        </button>
    );
}

// ------ Main Form ------

export function GridConfigForm({ configJson, onChange }: GridConfigFormProps) {
    const t = useTranslations("botNew.form");
    const [showRisk, setShowRisk] = useState(false);

    // Initialize State (Use generic copy from previous robust version)
    const [formState, setFormState] = useState<FormState>(() => {
        try {
            const p = JSON.parse(configJson);
            const schemaVersion = Number.isFinite(p?.schemaVersion) ? Math.trunc(p.schemaVersion) : 1;
            const isSym = p.sizing?.gridSymmetric ?? true;
            const isPercent = p.trigger?.gridType !== 'price';
            const percentDisplayFactor = isPercent ? (schemaVersion >= 2 ? 100 : 1) : 1;
            const pullbackDisplayFactor = schemaVersion >= 2 ? 100 : 1;
            const positionDisplayFactor = schemaVersion >= 2 ? 100 : 1;

            const expiryDaysRaw = p.lifecycle?.expiryDays;
            const expiryDays = typeof expiryDaysRaw === 'number' && Number.isFinite(expiryDaysRaw) ? Math.trunc(expiryDaysRaw) : -1;
            const enableExpires = expiryDays >= 0;
            return {
                basePriceType: p.trigger?.basePriceType || 'current',
                basePrice: p.trigger?.basePrice || '',
                gridType: p.trigger?.gridType || 'percent',
                isSymmetric: isSym,
                riseSell: isSym
                    ? (parseFloat(p.trigger?.riseSell || "0.02") * percentDisplayFactor).toString()
                    : (parseFloat(p.trigger?.riseSell || "0.02") * percentDisplayFactor).toString(),
                fallBuy: isSym
                    ? (parseFloat(p.trigger?.fallBuy || "0.02") * percentDisplayFactor).toString()
                    : (parseFloat(p.trigger?.fallBuy || "0.02") * percentDisplayFactor).toString(),
                enablePullback: p.trigger?.enablePullbackSell ?? false,
                pullbackPercent: p.trigger?.pullbackSellPercent ? (parseFloat(p.trigger.pullbackSellPercent) * pullbackDisplayFactor).toString() : "0.5",
                enableRebound: p.trigger?.enableReboundBuy ?? false,
                reboundPercent: p.trigger?.reboundBuyPercent ? (parseFloat(p.trigger.reboundBuyPercent) * pullbackDisplayFactor).toString() : "0.5",
                floorPrice: p.risk?.floorPrice || '',
                priceMax: p.trigger?.priceMax || '',
                expirationDays: enableExpires ? String(expiryDays) : "365",
                orderType: p.order?.orderType || 'limit',
                entryPriceSource: p.order?.entryPriceSource === 'orderbook' ? 'orderbook' : 'trigger',
                entryBookLevel: Number.isFinite(p.order?.entryBookLevel) ? String(Math.trunc(p.order.entryBookLevel)) : '1',
                amountMode: p.sizing?.amountMode || 'amount',
                gridCount: p.sizing?.symmetric?.orderQuantity || "20",
                amountPerGrid: p.sizing?.symmetric?.orderQuantity || "10",
                maxPositionPercent: p.position?.maxPositionPercent ? (parseFloat(p.position.maxPositionPercent) * positionDisplayFactor).toString() : "100",
                enableExpires,
            };
        } catch {
            return {
                basePriceType: 'current',
                basePrice: '',
                gridType: 'percent',
                isSymmetric: true,
                riseSell: "2",
                fallBuy: "2",
                enablePullback: false,
                pullbackPercent: "0.5",
                enableRebound: false,
                reboundPercent: "0.5",
                floorPrice: '',
                priceMax: '',
                expirationDays: '365',
                orderType: 'limit',
                entryPriceSource: 'trigger',
                entryBookLevel: '1',
                amountMode: 'amount',
                gridCount: "20",
                amountPerGrid: "10",
                maxPositionPercent: "100",
                enableExpires: false,
            };
        }
    });

    const updateJson = (newState: FormState) => {
        try {
            const currentConfig = JSON.parse(configJson);
            const isPercent = newState.gridType === 'percent';
            const multiplier = isPercent ? 100 : 1;

            const newConfig = {
                ...currentConfig,
                schemaVersion: 2,
                trigger: {
                    ...currentConfig.trigger,
                    gridType: newState.gridType,
                    basePriceType: newState.basePriceType,
                    basePrice: newState.basePriceType === 'manual' ? newState.basePrice : undefined,
                    riseSell: (parseFloat(newState.riseSell || '0') / multiplier).toString(),
                    fallBuy: (parseFloat(newState.fallBuy || '0') / multiplier).toString(),
                    priceMax: newState.priceMax || undefined,
                    enablePullbackSell: newState.enablePullback,
                    pullbackSellPercent: newState.enablePullback ? (parseFloat(newState.pullbackPercent || '0') / 100).toString() : undefined,
                    enableReboundBuy: newState.enableRebound,
                    reboundBuyPercent: newState.enableRebound ? (parseFloat(newState.reboundPercent || '0') / 100).toString() : undefined,
                },
                order: {
                    orderType: newState.orderType,
                    entryPriceSource: newState.entryPriceSource,
                    entryBookLevel:
                        newState.entryPriceSource === 'orderbook'
                            ? Math.max(1, Math.min(5, parseInt(newState.entryBookLevel || '1', 10)))
                            : undefined,
                },
                sizing: {
                    amountMode: newState.amountMode,
                    gridSymmetric: newState.isSymmetric,
                    symmetric: { orderQuantity: newState.amountPerGrid },
                    asymmetric: { buyQuantity: newState.amountPerGrid, sellQuantity: newState.amountPerGrid }
                },
                position: { maxPositionPercent: (parseFloat(newState.maxPositionPercent) / 100).toString() },
                lifecycle: { ...(currentConfig.lifecycle ?? {}), expiryDays: newState.enableExpires ? parseInt(newState.expirationDays || '365', 10) : -1 },
                risk: { enableFloorPrice: !!newState.floorPrice, floorPrice: newState.floorPrice || undefined }
            };
            onChange(JSON.stringify(newConfig, null, 2));
        } catch (e) {
            console.error(e);
        }
    };

    const handleChange = (field: keyof FormState, value: any) => {
        let newState = { ...formState, [field]: value };
        // Sync Logic
        if (newState.isSymmetric) {
            if (field === 'isSymmetric' && value === true) {
                newState.fallBuy = newState.riseSell;
                newState.enableRebound = newState.enablePullback;
                newState.reboundPercent = newState.pullbackPercent;
            }
            if (field === 'riseSell') newState.fallBuy = value;
            if (field === 'fallBuy') newState.riseSell = value;
            if (field === 'enablePullback') newState.enableRebound = value;
            if (field === 'pullbackPercent') newState.reboundPercent = value;
        }
        setFormState(newState);
        updateJson(newState);
    };

    const unit = formState.gridType === 'percent' ? '%' : '$';

    return (
        <div className="space-y-8 animate-in fade-in pb-12">

            {/* 1. Core Trigger Strategy */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <SectionHeader icon={Zap} title={t('gridStrategyTitle')} subtitle={t('gridStrategySubtitle')} />

                {/* Global Settings Row */}
                <div className="flex items-center justify-between mb-6 pb-6 border-b border-slate-100">
                    <div className="flex items-center gap-4">
                        <InputGroup label={t('triggerBase')}>
                            <div className="flex items-center bg-slate-50 rounded-lg p-1 border border-slate-200">
                                <button
                                    onClick={() => handleChange('basePriceType', 'current')}
                                    className={clsx("px-3 py-1.5 text-xs font-bold rounded transition-colors", formState.basePriceType === 'current' ? "bg-white shadow text-slate-800" : "text-slate-400 hover:text-slate-600")}
                                >
                                    {t('currentPrice')}
                                </button>
                                <button
                                    onClick={() => handleChange('basePriceType', 'manual')}
                                    className={clsx("px-3 py-1.5 text-xs font-bold rounded transition-colors", formState.basePriceType === 'manual' ? "bg-white shadow text-slate-800" : "text-slate-400 hover:text-slate-600")}
                                >
                                    {t('manualPrice')}
                                </button>
                            </div>
                        </InputGroup>

                        {formState.basePriceType === 'manual' && (
                            <div className="w-32 pt-5 animate-in fade-in slide-in-from-left-2">
                                <CleanInput value={formState.basePrice} onChange={(v) => handleChange('basePrice', v)} placeholder="0.00" />
                            </div>
                        )}
                    </div>

                    <InputGroup label={t('gridType')}>
                        <div className="flex bg-slate-100 rounded-lg p-1">
                            <ToggleButton active={formState.gridType === 'percent'} label={t('typePercent')} onClick={() => handleChange('gridType', 'percent')} />
                            <ToggleButton active={formState.gridType === 'price'} label={t('typePrice')} onClick={() => handleChange('gridType', 'price')} />
                        </div>
                    </InputGroup>
                </div>

                {/* The Grid Visualizer Logic */}
                <div className="space-y-6">
                    {/* Header with Symmetric Toggle */}
                    <div className="flex items-center justify-between">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">{t('triggerLogic')}</div>
                        <div className="flex items-center gap-2">
                            <span className={clsx("text-xs font-medium", formState.isSymmetric ? "text-indigo-600" : "text-slate-400")}>
                                {formState.isSymmetric ? t('symmetricMode') : t('manualMode')}
                            </span>
                            <button onClick={() => handleChange('isSymmetric', !formState.isSymmetric)} className="text-slate-400 hover:text-indigo-600 transition-colors">
                                {formState.isSymmetric ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Sell Side (Up) */}
                        <div className="relative">
                            <div className="flex items-center gap-2 mb-3 text-rose-500">
                                <TrendingUp className="w-4 h-4" />
                                <span className="font-bold text-sm">{t('sellHigher')}</span>
                            </div>

                            <div className="bg-slate-50/50 rounded-xl p-4 border border-slate-100 transition-all hover:border-rose-100 hover:bg-rose-50/10">
                                <div className="flex items-end gap-3 mb-4">
                                    <InputGroup label={t('rise')} suffix={unit} className="flex-1">
                                        <CleanInput value={formState.riseSell} onChange={(v) => handleChange('riseSell', v)} />
                                    </InputGroup>
                                    <div className="pb-2 text-slate-400 text-xs font-medium">{t('gridStep')}</div>
                                </div>

                                {/* Trailing Logic */}
                                <div className="flex items-center justify-between py-2 border-t border-slate-100">
                                    <div className="flex items-center gap-2">
                                        <div className={clsx("w-2 h-2 rounded-full", formState.enablePullback ? "bg-rose-500" : "bg-slate-300")} />
                                        <span className="text-xs font-medium text-slate-600">{t('trailingSell')}</span>
                                    </div>
                                    <Switch checked={formState.enablePullback} onChange={(v) => handleChange('enablePullback', v)} />
                                </div>

                                {formState.enablePullback && (
                                    <div className="mt-3 flex items-center gap-3 animate-in fade-in slide-in-from-top-1">
                                        <RotateCcw className="w-3 h-3 text-rose-400 flip-x" />
                                        <InputGroup label={t('callback')} suffix="%" className="flex-1">
                                            <CleanInput value={formState.pullbackPercent} onChange={(v) => handleChange('pullbackPercent', v)} />
                                        </InputGroup>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Buy Side (Down) */}
                        <div className="relative">
                            <div className="flex items-center gap-2 mb-3 text-emerald-500">
                                <TrendingDown className="w-4 h-4" />
                                <span className="font-bold text-sm">{t('buyLower')}</span>
                            </div>

                            <div className="bg-slate-50/50 rounded-xl p-4 border border-slate-100 transition-all hover:border-emerald-100 hover:bg-emerald-50/10">
                                <div className="flex items-end gap-3 mb-4">
                                    <InputGroup label={t('fall')} suffix={unit} className="flex-1">
                                        <CleanInput value={formState.fallBuy} onChange={(v) => handleChange('fallBuy', v)} disabled={formState.isSymmetric} />
                                    </InputGroup>
                                    <div className="pb-2 text-slate-400 text-xs font-medium">{t('gridStep')}</div>
                                </div>

                                {/* Trailing Logic */}
                                <div className="flex items-center justify-between py-2 border-t border-slate-100">
                                    <div className="flex items-center gap-2">
                                        <div className={clsx("w-2 h-2 rounded-full", formState.enableRebound ? "bg-emerald-500" : "bg-slate-300")} />
                                        <span className="text-xs font-medium text-slate-600">{t('trailingBuy')}</span>
                                    </div>
                                    <Switch checked={formState.enableRebound} onChange={(v) => handleChange('enableRebound', v)} disabled={formState.isSymmetric} />
                                </div>

                                {formState.enableRebound && (
                                    <div className="mt-3 flex items-center gap-3 animate-in fade-in slide-in-from-top-1">
                                        <RotateCcw className="w-3 h-3 text-emerald-400" />
                                        <InputGroup label={t('rebound')} suffix="%" className="flex-1">
                                            <CleanInput value={formState.reboundPercent} onChange={(v) => handleChange('reboundPercent', v)} disabled={formState.isSymmetric} />
                                        </InputGroup>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 2. Position & Money */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <SectionHeader icon={Settings} title={t('positionMoneyTitle')} subtitle={t('positionMoneySubtitle')} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                        <InputGroup label={t('amountPerGrid')}>
                            <div className="flex gap-2">
                                <CleanInput value={formState.amountPerGrid} onChange={(v) => handleChange('amountPerGrid', v)} />
                                <div className="flex bg-slate-100 rounded-lg p-1 shrink-0">
                                    <ToggleButton active={formState.amountMode === 'amount'} label="USDT" onClick={() => handleChange('amountMode', 'amount')} />
                                    <ToggleButton active={formState.amountMode === 'percent'} label="%" onClick={() => handleChange('amountMode', 'percent')} />
                                </div>
                            </div>
                        </InputGroup>
                    </div>
                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('maxPosition')}</label>
                            <span className="text-xs font-mono font-bold text-indigo-600 px-2 rounded bg-indigo-50 border border-indigo-100">{formState.maxPositionPercent}%</span>
                        </div>
                        <input
                            type="range"
                            min="10"
                            max="100"
                            step="10"
                            value={formState.maxPositionPercent}
                            onChange={(e) => handleChange("maxPositionPercent", e.target.value)}
                            className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                    </div>
                </div>
                <div className="mt-6 flex justify-end">
                    <div className="inline-flex bg-slate-50 rounded-lg p-0.5 border border-slate-200">
                        <ToggleButton active={formState.orderType === 'limit'} label={t('limitOrder')} onClick={() => handleChange('orderType', 'limit')} />
                        <ToggleButton active={formState.orderType === 'market'} label={t('marketOrder')} onClick={() => handleChange('orderType', 'market')} />
                    </div>
                </div>

                <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('entryPriceSource')}</label>
                        <div className="inline-flex bg-slate-50 rounded-lg p-0.5 border border-slate-200">
                            <ToggleButton
                                active={formState.entryPriceSource === 'trigger'}
                                label={t('entryPriceTrigger')}
                                onClick={() => handleChange('entryPriceSource', 'trigger')}
                            />
                            <ToggleButton
                                active={formState.entryPriceSource === 'orderbook'}
                                label={t('entryPriceOrderbook')}
                                onClick={() => handleChange('entryPriceSource', 'orderbook')}
                            />
                        </div>
                    </div>

                    {formState.entryPriceSource === 'orderbook' && (
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('entryBookLevel')}</label>
                            <div className="inline-flex bg-slate-50 rounded-lg p-0.5 border border-slate-200">
                                {[1, 2, 3, 4, 5].map((n) => (
                                    <ToggleButton
                                        key={n}
                                        active={formState.entryBookLevel === String(n)}
                                        label={String(n)}
                                        onClick={() => handleChange('entryBookLevel', String(n))}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {formState.entryPriceSource === 'orderbook' && (
                        <p className="text-xs text-slate-400">{t('entryBookLevelHint')}</p>
                    )}
                </div>
            </div>

            {/* 3. Risk Protection (Collapsible) */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all">
                <button
                    onClick={() => setShowRisk(!showRisk)}
                    className="w-full flex items-center justify-between p-5 bg-slate-50/50 hover:bg-slate-50 transition-colors"
                >
                    <div className="flex items-center gap-2 text-slate-800">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        <span className="text-sm font-bold">{t('advancedProtection')}</span>
                    </div>
                    {showRisk ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>

                {showRisk && (
                    <div className="p-5 border-t border-slate-100 animate-in slide-in-from-top-2">
                        <div className="grid grid-cols-2 gap-6">
                            <InputGroup label={t('stopLossLabel')} suffix="$">
                                <CleanInput value={formState.floorPrice} onChange={(v) => handleChange('floorPrice', v)} placeholder={t('noStopLoss')} />
                            </InputGroup>
                            <InputGroup label={t('takeProfitLabel')} suffix="$">
                                <CleanInput value={formState.priceMax} onChange={(v) => handleChange('priceMax', v)} placeholder={t('noLimit')} />
                            </InputGroup>
                        </div>

                        <div className="mt-6 flex items-center justify-between pt-4 border-t border-slate-50">
                            <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-slate-400" />
                                <span className="text-sm text-slate-600 font-medium">{t('autoExpiration')}</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-slate-400">{t('validityHint')}</span>
                                <Switch checked={formState.enableExpires} onChange={(v) => handleChange('enableExpires', v)} />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Summary Footer */}
            <div className="flex items-start gap-3 text-xs text-slate-500 px-2 max-w-2xl mx-auto text-center justify-center">
                <HelpCircle className="w-4 h-4 mt-0.5 shrink-0 opacity-50" />
                <p>
                    {t('summaryTemplate', { step: formState.riseSell, unit })}
                    {formState.enablePullback && t('summaryPullback', { percent: formState.pullbackPercent })}
                    {formState.enableRebound && t('summaryRebound', { percent: formState.reboundPercent })}
                </p>
            </div>
        </div>
    );
}
