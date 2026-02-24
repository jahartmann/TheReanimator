'use client';

import { useState, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { Button } from '@/components/ui/button';
import { Terminal, X, Send, Maximize2, Minimize2, Loader2, Search, ChevronRight, AlertCircle, Command } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { cn } from '@/lib/utils';
// @ts-ignore
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { getAISettings } from '@/lib/actions/ai';
import Link from 'next/link';

export function AIAssistant() {
    const t = useTranslations('aiAssistant');
    const [isOpen, setIsOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [settings, setSettings] = useState<{ enabled: boolean; model: string } | null>(null);

    // Initial check for settings
    useEffect(() => {
        getAISettings().then(setSettings);
    }, [isOpen]);

    const { messages, status, sendMessage, stop, regenerate } = useChat({
        onError: (err) => {
            console.error("AI Error", err);
        },
    });

    const [input, setInput] = useState('');
    const isLoading = status === 'streaming' || status === 'submitted';

    const handleInternalSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!input.trim()) return;

        await sendMessage({
            id: Date.now().toString(),
            role: 'user',
            content: input
        } as any);

        setInput('');
    };

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    if (settings && (!settings.enabled || !settings.model)) {
        // Render simple "Not Configured" state if open
        if (!isOpen) {
            return (
                <div className="fixed bottom-6 right-6 z-50">
                    <button
                        onClick={() => setIsOpen(true)}
                        className="h-12 w-12 rounded-lg shadow-lg bg-zinc-900 border border-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center hover:bg-zinc-800 transition-all group"
                    >
                        <Terminal size={20} />
                        <span className="absolute right-14 bg-zinc-900 text-white text-xs px-2 py-1 rounded border border-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                            Infrastructure Helper
                        </span>
                    </button>
                </div>
            );
        }

        return (
            <div className="fixed bottom-6 right-6 z-50 w-80 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl p-6 flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-zinc-100 font-medium">
                        <Terminal size={18} />
                        <span>Command Center</span>
                    </div>
                    <button onClick={() => setIsOpen(false)} className="text-zinc-500 hover:text-white">
                        <X size={16} />
                    </button>
                </div>
                <div className="bg-zinc-900/50 p-4 rounded border border-dashed border-zinc-800 text-center">
                    <AlertCircle className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                    <p className="text-sm text-zinc-400 mb-4">{t('notConfigured')}</p>
                    <Link href="/settings" className="inline-flex items-center justify-center px-4 py-2 bg-zinc-100 text-zinc-900 text-sm font-medium rounded hover:bg-white transition-colors">
                        {t('configureNow')}
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-4 font-mono">
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.98, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 10 }}
                        transition={{ duration: 0.15 }}
                        className={cn(
                            "bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl flex flex-col overflow-hidden transition-all duration-300",
                            isExpanded ? "w-[90vw] h-[85vh] md:w-[800px] md:h-[650px]" : "w-[400px] h-[600px]"
                        )}
                    >
                        {/* Professional Header */}
                        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between select-none">
                            <div className="flex items-center gap-3">
                                <div className="w-6 h-6 rounded bg-zinc-800 flex items-center justify-center shadow-inner">
                                    <Terminal size={14} className="text-emerald-500" />
                                </div>
                                <div>
                                    <h3 className="font-medium text-xs text-zinc-200 tracking-wide uppercase">Infrastructure Assistant</h3>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                        <p className="text-[10px] text-zinc-500 font-medium">ONLINE - {settings?.model || 'Unknown Model'}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 rounded" onClick={() => setIsExpanded(!isExpanded)}>
                                    {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 rounded" onClick={() => setIsOpen(false)}>
                                    <X size={14} />
                                </Button>
                            </div>
                        </div>

                        {/* Messages Area */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth bg-zinc-950" ref={scrollRef}>
                            {messages.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-zinc-600">
                                    <div className="w-16 h-16 rounded-full bg-zinc-900/50 border border-zinc-800 flex items-center justify-center mb-6">
                                        <Command className="w-8 h-8 opacity-50" />
                                    </div>
                                    <h4 className="text-zinc-300 font-medium mb-2">Ready for Commands</h4>
                                    <p className="text-xs max-w-[240px] leading-relaxed">
                                        I can help you analyze logs, manage VMs, perform backups, or troubleshoot network issues.
                                    </p>

                                    <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-2 w-full max-w-sm">
                                        {['Check Server Health', 'List active VMs', 'Show Backup Status', 'Analyze Logs'].map((suggestion) => (
                                            <button
                                                key={suggestion}
                                                onClick={() => { setInput(suggestion); }}
                                                className="text-xs text-left px-3 py-2 bg-zinc-900/30 border border-zinc-800/50 hover:bg-zinc-800/50 hover:border-zinc-700 rounded transition-colors text-zinc-400"
                                            >
                                                <span className="text-zinc-600 mr-2">$</span>
                                                {suggestion}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {messages.map((m: any) => (
                                <ChatMessage key={m.id} role={m.role} content={m.content} toolInvocations={m.toolInvocations} timestamp={m.createdAt ? new Date(m.createdAt).getTime() : Date.now()} />
                            ))}

                            {isLoading && (
                                <div className="flex gap-3 mr-auto items-center animate-pulse pl-1">
                                    <span className="text-emerald-500 text-xs font-mono">_ processing</span>
                                </div>
                            )}
                        </div>

                        {/* Professional Input Area */}
                        <form onSubmit={handleInternalSubmit} className="p-3 bg-zinc-900/30 border-t border-zinc-800 flex gap-2 items-center">
                            <div className="flex-1 relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 font-mono text-sm pointer-events-none">{">"}</span>
                                <input
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    placeholder="Enter command or query..."
                                    className="w-full bg-zinc-950 rounded border border-zinc-800 focus:border-emerald-500/50 pl-7 pr-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-emerald-500/20 font-mono placeholder:text-zinc-600"
                                    disabled={isLoading}
                                    autoFocus
                                />
                            </div>
                            <Button
                                type="submit"
                                size="icon"
                                className={cn(
                                    "h-10 w-10 rounded border border-zinc-800 transition-all",
                                    input.trim()
                                        ? "bg-emerald-600 hover:bg-emerald-500 text-white border-transparent"
                                        : "bg-zinc-900 text-zinc-600 hover:bg-zinc-800"
                                )}
                                disabled={isLoading || !input.trim()}
                            >
                                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                            </Button>
                        </form>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Concise Toggle Button (Terminal Style) */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="h-12 w-12 rounded-lg shadow-xl bg-zinc-900 border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 flex items-center justify-center transition-all group hover:-translate-y-1"
                >
                    <Terminal size={20} />
                    {/* Tooltip */}
                    <span className="absolute right-14 bg-zinc-900 text-zinc-300 text-xs px-2 py-1 rounded border border-zinc-800 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg">
                        Open Command Center
                    </span>

                    {/* Status Dot */}
                    {settings?.enabled && (
                        <span className="absolute top-0 right-0 -mt-1 -mr-1 w-3 h-3 bg-emerald-950 rounded-full border border-zinc-900 flex items-center justify-center">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                        </span>
                    )}
                </button>
            )}
        </div>
    );
}
