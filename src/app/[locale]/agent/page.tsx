'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
    Bot, Send, Loader2, Trash2, MessageSquare, Zap, Server, HardDrive,
    Plus, Brain, Search, X, ChevronRight, Clock, Wrench
} from 'lucide-react';
import { ChatMessage } from '@/components/ai/ChatMessage';
import { VMWizard } from '@/components/agent/VMWizard';
import { cn } from '@/lib/utils';
import { getRecentChatSessions, getChatSessionMessages, deleteChatSession } from '@/lib/actions/chat';
import { searchBrainEntriesAction, getBrainEntries, removeBrainEntry, getBrainStats } from '@/lib/actions/brain';
import type { ChatSession } from '@/lib/actions/chat';
import type { BrainEntry } from '@/lib/actions/brain';

// crypto.randomUUID() requires HTTPS — use a safe fallback for HTTP local networks
const genId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    component?: string;
}

const SUGGESTIONS = [
    { icon: Server, text: 'Server-Status anzeigen', color: 'text-blue-500' },
    { icon: HardDrive, text: 'Backup-Status prüfen', color: 'text-green-500' },
    { icon: MessageSquare, text: 'Alle VMs auflisten', color: 'text-purple-500' },
    { icon: Zap, text: 'VM erstellen', color: 'text-amber-500' },
];

// ── Helpers ──────────────────────────────────────────────────────

function groupSessionsByDate(sessions: ChatSession[]): { label: string; sessions: ChatSession[] }[] {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;

    const groups: { label: string; sessions: ChatSession[] }[] = [
        { label: 'Heute', sessions: [] },
        { label: 'Gestern', sessions: [] },
        { label: 'Älter', sessions: [] },
    ];

    for (const s of sessions) {
        const d = new Date(s.updated_at).getTime();
        if (d >= today) groups[0].sessions.push(s);
        else if (d >= yesterday) groups[1].sessions.push(s);
        else groups[2].sessions.push(s);
    }

    return groups.filter(g => g.sessions.length > 0);
}

function formatTime(dateStr: string): string {
    try {
        return new Date(dateStr).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
}

// ── Main Component ──────────────────────────────────────────────

export default function AgentPage() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState<number | null>(null);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [brainOpen, setBrainOpen] = useState(false);
    const [statusText, setStatusText] = useState<string | null>(null);
    const [activeTools, setActiveTools] = useState<string[]>([]);

    // Brain state
    const [brainQuery, setBrainQuery] = useState('');
    const [brainEntries, setBrainEntries] = useState<BrainEntry[]>([]);
    const [brainStats, setBrainStats] = useState<{ total: number; domains: { domain: string; count: number }[] } | null>(null);
    const [expandedBrain, setExpandedBrain] = useState<string | null>(null);
    const [brainLoading, setBrainLoading] = useState(false);

    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // ── Load sessions on mount ──
    useEffect(() => {
        loadSessions();
    }, []);

    // Auto-focus on mount
    useEffect(() => { inputRef.current?.focus(); }, []);

    // Scroll to bottom on new messages
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Auto-resize textarea
    useEffect(() => {
        const ta = inputRef.current;
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }, [input]);

    const loadSessions = async () => {
        try {
            const recent = await getRecentChatSessions(30);
            setSessions(recent);
        } catch (e) {
            console.error('Failed to load sessions:', e);
        }
    };

    const loadSession = async (id: number) => {
        try {
            const msgs = await getChatSessionMessages(id);
            setMessages(msgs.map(m => ({
                id: genId(),
                role: m.role as 'user' | 'assistant',
                content: m.content,
                timestamp: new Date(m.created_at).getTime(),
            })));
            setSessionId(id);
            setTimeout(() => inputRef.current?.focus(), 50);
        } catch (e) {
            console.error('Failed to load session:', e);
        }
    };

    const startNewChat = () => {
        setMessages([]);
        setSessionId(null);
        setInput('');
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    const handleDeleteSession = async (id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('Session löschen?')) return;
        try {
            await deleteChatSession(id);
            if (sessionId === id) startNewChat();
            await loadSessions();
        } catch (err) {
            console.error('Failed to delete session:', err);
        }
    };

    // ── Brain functions ──
    const loadBrain = useCallback(async () => {
        setBrainLoading(true);
        try {
            const [entries, stats] = await Promise.all([
                getBrainEntries({ limit: 50 }),
                getBrainStats(),
            ]);
            setBrainEntries(entries);
            setBrainStats(stats);
        } catch (e) {
            console.error('Failed to load brain:', e);
        } finally {
            setBrainLoading(false);
        }
    }, []);

    const searchBrain = async (query: string) => {
        if (!query.trim()) {
            loadBrain();
            return;
        }
        setBrainLoading(true);
        try {
            const results = await searchBrainEntriesAction(query);
            setBrainEntries(results.map(r => r.entry));
        } catch (e) {
            console.error('Brain search failed:', e);
        } finally {
            setBrainLoading(false);
        }
    };

    const handleDeleteBrainEntry = async (key: string) => {
        if (!confirm('Eintrag löschen?')) return;
        await removeBrainEntry(key);
        loadBrain();
    };

    useEffect(() => {
        if (brainOpen) loadBrain();
    }, [brainOpen, loadBrain]);

    // ── Send message ──
    const sendMessage = async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || isLoading) return;

        const userMsg: Message = {
            id: genId(),
            role: 'user',
            content: trimmed,
            timestamp: Date.now(),
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);
        if (inputRef.current) inputRef.current.style.height = 'auto';

        // VM Wizard shortcut
        if (trimmed.toLowerCase().includes('create vm') || trimmed.toLowerCase().includes('eine vm erstellen')) {
            setMessages(prev => [...prev, {
                id: genId(),
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                component: 'VMWizard',
            }]);
            setIsLoading(false);
            return;
        }

        const assistantId = genId();
        setMessages(prev => [...prev, {
            id: assistantId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
        }]);

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [...messages, userMsg].map(m => ({
                        role: m.role,
                        content: m.content,
                    })),
                    sessionId: sessionId || undefined,
                }),
            });

            if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);

            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            let accumulated = '';

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const text = decoder.decode(value);
                    for (const line of text.split('\n')) {
                        if (!line || line.length < 2) continue;
                        const prefix = line.slice(0, 2);
                        const payload = line.slice(2);

                        try {
                            switch (prefix) {
                                case 's:': {
                                    // Session ID
                                    const data = JSON.parse(payload);
                                    if (data.id && !sessionId) {
                                        setSessionId(data.id);
                                        setTimeout(loadSessions, 500);
                                    }
                                    break;
                                }
                                case '0:': {
                                    // Content text
                                    const chunk = JSON.parse(payload);
                                    if (typeof chunk === 'string') {
                                        accumulated += chunk;
                                        setStatusText(null); // Clear status when content arrives
                                        setMessages(prev =>
                                            prev.map(m => m.id === assistantId ? { ...m, content: accumulated } : m)
                                        );
                                    }
                                    break;
                                }
                                case 'i:': {
                                    // Status indicator (transient)
                                    const status = JSON.parse(payload);
                                    setStatusText(status);
                                    break;
                                }
                                case 't:': {
                                    // Tool start
                                    const toolName = JSON.parse(payload);
                                    setActiveTools(prev => [...prev, toolName]);
                                    setStatusText(null);
                                    break;
                                }
                                case 'T:': {
                                    // Tool end
                                    const toolName = JSON.parse(payload);
                                    setActiveTools(prev => prev.filter(t => t !== toolName));
                                    break;
                                }
                            }
                        } catch { /* skip malformed */ }
                    }
                }
            }

            // Refresh sessions after response (to pick up auto-title)
            setTimeout(loadSessions, 1000);
        } catch (err: any) {
            setMessages(prev =>
                prev.map(m => m.id === assistantId
                    ? { ...m, role: 'system' as const, content: `Fehler: ${err.message || 'Verbindung fehlgeschlagen'}` }
                    : m
                )
            );
        } finally {
            setIsLoading(false);
            setStatusText(null);
            setActiveTools([]);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(input);
        }
    };

    const lastMsg = messages[messages.length - 1];
    const showTyping = isLoading && lastMsg?.role === 'assistant' && lastMsg?.content === '';
    const groupedSessions = groupSessionsByDate(sessions);

    return (
        <div className="fixed inset-0 left-64 flex bg-background">

            {/* ── Session Sidebar ──────────────────────────────── */}
            {sidebarOpen && (
                <div className="w-64 shrink-0 border-r bg-muted/30 flex flex-col">
                    <div className="p-3 border-b flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Verlauf</span>
                        <button
                            onClick={startNewChat}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                        >
                            <Plus className="w-3 h-3" />
                            Neu
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {sessions.length === 0 ? (
                            <p className="p-4 text-xs text-muted-foreground text-center">Keine Unterhaltungen</p>
                        ) : (
                            groupedSessions.map(group => (
                                <div key={group.label}>
                                    <p className="px-3 pt-3 pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                        {group.label}
                                    </p>
                                    {group.sessions.map(s => (
                                        <button
                                            key={s.id}
                                            onClick={() => loadSession(s.id)}
                                            className={cn(
                                                'w-full text-left px-3 py-2 text-xs hover:bg-muted/60 transition-colors group flex items-center gap-2',
                                                sessionId === s.id && 'bg-muted'
                                            )}
                                        >
                                            <MessageSquare className="w-3 h-3 shrink-0 text-muted-foreground" />
                                            <div className="flex-1 min-w-0">
                                                <p className="truncate">
                                                    {s.title || 'Neue Unterhaltung'}
                                                </p>
                                                <p className="text-[10px] text-muted-foreground">
                                                    {formatTime(s.updated_at)}
                                                </p>
                                            </div>
                                            <button
                                                onClick={(e) => handleDeleteSession(s.id, e)}
                                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-destructive transition-opacity"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        </button>
                                    ))}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* ── Main Chat Area ──────────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0">

                {/* ── Header ──────────────────────────────────────── */}
                <header className="shrink-0 flex items-center justify-between px-4 py-3 border-b bg-background/95 backdrop-blur-sm">
                    <div className="flex items-center gap-2.5">
                        <button
                            onClick={() => setSidebarOpen(v => !v)}
                            className="p-1 rounded-md hover:bg-muted transition-colors"
                        >
                            <ChevronRight className={cn('w-4 h-4 transition-transform', sidebarOpen && 'rotate-180')} />
                        </button>
                        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                            <Bot className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                            <p className="font-semibold text-sm leading-tight">Reanimator Agent</p>
                            <p className="text-[11px] text-muted-foreground leading-tight">Infrastructure Assistant</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setBrainOpen(v => !v)}
                            className={cn(
                                'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md transition-colors',
                                brainOpen
                                    ? 'bg-primary/10 text-primary'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                            )}
                        >
                            <Brain className="w-3.5 h-3.5" />
                            Brain
                        </button>
                        {messages.length > 0 && (
                            <button
                                onClick={startNewChat}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                Neu
                            </button>
                        )}
                    </div>
                </header>

                {/* ── Content Area (Chat + Brain Panel) ───────────── */}
                <div className="flex-1 flex overflow-hidden">

                    {/* ── Messages ──────────────────────────────── */}
                    <div className="flex-1 flex flex-col min-w-0">
                        <div className="flex-1 overflow-y-auto">
                            {messages.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center px-6 pb-20 text-center">
                                    <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
                                        <Bot className="w-6 h-6 text-primary" />
                                    </div>
                                    <h2 className="text-lg font-semibold mb-2">Reanimator Agent</h2>
                                    <p className="text-sm text-muted-foreground max-w-sm mb-8 leading-relaxed">
                                        Proxmox Infrastructure Assistant. Frag nach Servern, VMs und Backups oder starte den VM-Wizard.
                                    </p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                                        {SUGGESTIONS.map(({ icon: Icon, text, color }) => (
                                            <button
                                                key={text}
                                                type="button"
                                                onClick={() => sendMessage(text)}
                                                className="flex items-center gap-3 px-4 py-3 text-left text-sm rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors"
                                            >
                                                <Icon className={cn('w-4 h-4 shrink-0', color)} />
                                                <span>{text}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="py-8 px-4 space-y-6 max-w-4xl mx-auto">
                                    {messages.map(m => (
                                        <div key={m.id}>
                                            {m.component === 'VMWizard' ? (
                                                <VMWizard
                                                    onComplete={cmd => sendMessage(cmd)}
                                                    onCancel={() => setMessages(prev => [...prev, {
                                                        id: genId(),
                                                        role: 'system',
                                                        content: 'VM-Erstellung abgebrochen',
                                                        timestamp: Date.now(),
                                                    }])}
                                                />
                                            ) : (
                                                <ChatMessage role={m.role} content={m.content} timestamp={m.timestamp} />
                                            )}
                                        </div>
                                    ))}

                                    {/* Status / Typing / Tool indicator */}
                                    {isLoading && (statusText || activeTools.length > 0 || showTyping) && (
                                        <div className="flex gap-3 animate-in fade-in duration-200">
                                            <div className="shrink-0 w-8 h-8 rounded-md bg-muted border border-border/50 flex items-center justify-center">
                                                <Bot className="w-4 h-4 text-muted-foreground" />
                                            </div>
                                            <div className="flex flex-col gap-1.5">
                                                {/* Active tools as pills */}
                                                {activeTools.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {activeTools.map(tool => (
                                                            <span key={tool} className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-full bg-primary/10 text-primary border border-primary/20">
                                                                <Wrench className="w-3 h-3 animate-spin" style={{ animationDuration: '2s' }} />
                                                                {tool}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                {/* Status text or typing dots */}
                                                {statusText ? (
                                                    <span className="text-xs text-muted-foreground italic">{statusText}</span>
                                                ) : showTyping ? (
                                                    <div className="bg-muted rounded-xl px-4 py-2.5 flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                                                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                                                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
                                                    </div>
                                                ) : null}
                                            </div>
                                        </div>
                                    )}

                                    <div ref={bottomRef} />
                                </div>
                            )}
                        </div>

                        {/* ── Input ──────────────────────────────── */}
                        <div className="shrink-0 border-t bg-background/95 backdrop-blur-sm px-4 py-3">
                            <div className="flex items-end gap-2 max-w-4xl mx-auto">
                                <textarea
                                    ref={inputRef}
                                    value={input}
                                    onChange={e => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Nachricht schreiben... (Enter zum Senden, Shift+Enter für Zeilenumbruch)"
                                    disabled={isLoading}
                                    rows={1}
                                    className="flex-1 resize-none rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring min-h-[44px] max-h-[200px] transition-colors disabled:opacity-50"
                                />
                                <button
                                    type="button"
                                    onClick={() => sendMessage(input)}
                                    disabled={isLoading || !input.trim()}
                                    className={cn(
                                        'shrink-0 h-[44px] w-[44px] rounded-lg flex items-center justify-center transition-colors',
                                        input.trim() && !isLoading
                                            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                            : 'bg-muted text-muted-foreground/40 cursor-not-allowed'
                                    )}
                                >
                                    {isLoading
                                        ? <Loader2 className="w-4 h-4 animate-spin" />
                                        : <Send className="w-4 h-4" />
                                    }
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* ── Brain Panel (right slide-over) ────────── */}
                    {brainOpen && (
                        <div className="w-80 shrink-0 border-l bg-muted/20 flex flex-col">
                            <div className="p-3 border-b flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Brain className="w-4 h-4 text-primary" />
                                    <span className="text-sm font-medium">Brain</span>
                                    {brainStats && (
                                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                            {brainStats.total} Einträge
                                        </span>
                                    )}
                                </div>
                                <button onClick={() => setBrainOpen(false)} className="p-1 hover:bg-muted rounded-md">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            {/* Search */}
                            <div className="p-2 border-b">
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                                    <input
                                        type="text"
                                        value={brainQuery}
                                        onChange={e => setBrainQuery(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && searchBrain(brainQuery)}
                                        placeholder="Brain durchsuchen..."
                                        className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                                    />
                                </div>
                            </div>

                            {/* Domain stats */}
                            {brainStats && brainStats.domains.length > 0 && (
                                <div className="p-2 border-b flex flex-wrap gap-1">
                                    {brainStats.domains.slice(0, 6).map(d => (
                                        <button
                                            key={d.domain}
                                            onClick={() => {
                                                setBrainQuery(d.domain);
                                                searchBrain(d.domain);
                                            }}
                                            className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                                        >
                                            {d.domain} ({d.count})
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Entries list */}
                            <div className="flex-1 overflow-y-auto">
                                {brainLoading ? (
                                    <div className="p-4 text-center">
                                        <Loader2 className="w-4 h-4 animate-spin mx-auto text-muted-foreground" />
                                    </div>
                                ) : brainEntries.length === 0 ? (
                                    <p className="p-4 text-xs text-muted-foreground text-center">Keine Einträge</p>
                                ) : (
                                    brainEntries.map(entry => (
                                        <div
                                            key={entry.key}
                                            className="border-b last:border-b-0"
                                        >
                                            <button
                                                onClick={() => setExpandedBrain(expandedBrain === entry.key ? null : entry.key)}
                                                className="w-full text-left p-2.5 hover:bg-muted/40 transition-colors"
                                            >
                                                <div className="flex items-start gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs font-medium truncate">{entry.title}</p>
                                                        <div className="flex items-center gap-1.5 mt-0.5">
                                                            <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary">
                                                                {entry.domain}
                                                            </span>
                                                            {entry.importance >= 7 && (
                                                                <span className="text-[10px] text-amber-500">★</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <ChevronRight className={cn(
                                                        'w-3 h-3 text-muted-foreground transition-transform shrink-0 mt-0.5',
                                                        expandedBrain === entry.key && 'rotate-90'
                                                    )} />
                                                </div>
                                            </button>

                                            {expandedBrain === entry.key && (
                                                <div className="px-2.5 pb-2.5">
                                                    <div className="bg-muted/50 rounded-md p-2 text-xs whitespace-pre-wrap max-h-48 overflow-y-auto">
                                                        {entry.summary || entry.content.slice(0, 500)}
                                                    </div>
                                                    <div className="flex items-center justify-between mt-1.5">
                                                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                                            <Clock className="w-2.5 h-2.5" />
                                                            {entry.access_count}x
                                                        </span>
                                                        <button
                                                            onClick={() => handleDeleteBrainEntry(entry.key)}
                                                            className="text-[10px] text-destructive hover:underline"
                                                        >
                                                            Löschen
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
