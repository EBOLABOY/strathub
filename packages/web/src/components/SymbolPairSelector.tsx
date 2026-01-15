"use client";

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, X, Wallet } from 'lucide-react';
import clsx from 'clsx';

// Common coins for quick selection (fallback)
const COMMON_BASE_COINS = ['BNB', 'BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI', 'ATOM', 'LTC', 'FIL'];
const COMMON_QUOTE_COINS = ['USDT', 'BUSD', 'USDC', 'BTC', 'ETH', 'BNB', 'FDUSD', 'TUSD', 'DAI'];

interface CoinSelectorProps {
    value: string;
    onChange: (value: string) => void;
    type: 'base' | 'quote';
    label: string;
    placeholder?: string;
    holdingCoins?: string[];  // User's holding coins from balance
}

export function CoinSelector({ value, onChange, type, label, placeholder, holdingCoins = [] }: CoinSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const commonCoins = type === 'base' ? COMMON_BASE_COINS : COMMON_QUOTE_COINS;

    // Filter holding coins based on search
    const filteredHoldingCoins = search
        ? holdingCoins.filter(coin =>
            coin.toLowerCase().includes(search.toLowerCase())
        )
        : holdingCoins;

    // Filter common coins based on search, excluding those already in holdings
    const filteredCommonCoins = (search
        ? commonCoins.filter(coin =>
            coin.toLowerCase().includes(search.toLowerCase())
        )
        : commonCoins
    ).filter(coin => !holdingCoins.includes(coin));

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.toUpperCase();
        setSearch(val);
        onChange(val);
        if (!isOpen) setIsOpen(true);
    };

    const handleSelect = (coin: string) => {
        onChange(coin);
        setSearch('');
        setIsOpen(false);
    };

    const handleClear = () => {
        onChange('');
        setSearch('');
        inputRef.current?.focus();
    };

    return (
        <div className="flex-1" ref={containerRef}>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                {label}
            </label>
            <div className="relative">
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={handleInputChange}
                    onFocus={() => setIsOpen(true)}
                    className={clsx(
                        "w-full px-4 py-3 pr-16 rounded-xl border focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all font-mono text-sm uppercase",
                        value ? "border-teal-200 bg-teal-50/30" : "border-slate-200 bg-white"
                    )}
                    placeholder={placeholder || (type === 'base' ? 'BNB' : 'USDT')}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {value && (
                        <button
                            type="button"
                            onClick={handleClear}
                            className="p-1 hover:bg-slate-100 rounded-md transition-colors"
                        >
                            <X className="w-3 h-3 text-slate-400" />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setIsOpen(!isOpen)}
                        className="p-1.5 hover:bg-slate-100 rounded-md transition-colors"
                    >
                        <ChevronDown className={clsx(
                            "w-4 h-4 text-slate-400 transition-transform",
                            isOpen && "rotate-180"
                        )} />
                    </button>
                </div>

                {/* Dropdown */}
                {isOpen && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-lg border border-slate-100 z-50 overflow-hidden max-h-80 overflow-y-auto">
                        {/* Holdings section - show if user has coins */}
                        {filteredHoldingCoins.length > 0 && (
                            <div className="p-3 border-b border-slate-100 bg-gradient-to-r from-teal-50 to-white">
                                <div className="flex items-center gap-1.5 text-xs text-teal-600 mb-2 font-medium">
                                    <Wallet className="w-3.5 h-3.5" />
                                    <span>我的持仓</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {filteredHoldingCoins.slice(0, 8).map(coin => (
                                        <button
                                            key={coin}
                                            type="button"
                                            onClick={() => handleSelect(coin)}
                                            className={clsx(
                                                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border",
                                                coin === value
                                                    ? "bg-teal-500 text-white border-teal-500"
                                                    : "bg-white text-teal-700 border-teal-200 hover:bg-teal-100 hover:border-teal-300"
                                            )}
                                        >
                                            {coin}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Common coins section */}
                        <div className="p-3 border-b border-slate-50">
                            <div className="text-xs text-slate-400 mb-2 font-medium">
                                {type === 'base' ? '常用交易币' : '常用结算币'}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {filteredCommonCoins.slice(0, 12).map(coin => (
                                    <button
                                        key={coin}
                                        type="button"
                                        onClick={() => handleSelect(coin)}
                                        className={clsx(
                                            "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                                            coin === value
                                                ? "bg-teal-500 text-white"
                                                : "bg-slate-50 text-slate-600 hover:bg-teal-50 hover:text-teal-600"
                                        )}
                                    >
                                        {coin}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Custom input hint */}
                        <div className="px-3 py-2 text-xs text-slate-400 bg-slate-50">
                            💡 也可以直接输入其他币种
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

interface SymbolPairSelectorProps {
    value: string;  // e.g., "BNB/USDT"
    onChange: (value: string) => void;
    baseLabel?: string;
    quoteLabel?: string;
    holdingCoins?: string[];  // User's holding coins from balance
}

export function SymbolPairSelector({
    value,
    onChange,
    baseLabel = '交易币',
    quoteLabel = '结算币',
    holdingCoins = []
}: SymbolPairSelectorProps) {
    // Parse current value
    const [baseCoin, quoteCoin] = value.includes('/')
        ? value.split('/')
        : [value, ''];

    const handleBaseChange = (base: string) => {
        onChange(`${base}/${quoteCoin}`);
    };

    const handleQuoteChange = (quote: string) => {
        onChange(`${baseCoin}/${quote}`);
    };

    return (
        <div className="flex gap-3 items-end">
            <CoinSelector
                value={baseCoin}
                onChange={handleBaseChange}
                type="base"
                label={baseLabel}
                placeholder="BNB"
                holdingCoins={holdingCoins}
            />

            <div className="pb-3 text-xl font-bold text-slate-300">/</div>

            <CoinSelector
                value={quoteCoin}
                onChange={handleQuoteChange}
                type="quote"
                label={quoteLabel}
                placeholder="USDT"
                holdingCoins={holdingCoins}
            />
        </div>
    );
}
