'use client';

import { useState, useRef, useEffect } from 'react';
import { Bot, Send, Loader2, Trash2, MessageSquare, Zap, Server, HardDrive } from 'lucide-react';
import { ChatMessage } from '@/components/ai/ChatMessage';
import { VMWizard } from '@/components/agent/VMWizard';
import { cn } from '@/lib/utils';

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
    { icon: Server,       text: 'Server-Status anzeigen',  color: 'text-blue-500'   },
    { icon: HardDrive,    text: 'Backup-Status prüfen',    color: 'text-green-500'  },
    { icon: MessageSquare,text: 'Alle VMs auflisten',      color: 'text-purple-500' },
    { icon: Zap,          text: 'VM erstellen',            color: 'text-amber-500'  },
];

export default function AgentPage() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput]       = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef  = useRef<HTMLTextAreaElement>(null);

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
                }),
            });

            if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);

            const reader  = res.body?.getReader();
            const decoder = new TextDecoder();
            let accumulated = '';

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const text = decoder.decode(value);
                    for (const line of text.split('\n')) {
                        if (!line.startsWith('0:')) continue;
                        try {
                            const chunk = JSON.parse(line.slice(2));
                            if (typeof chunk === 'string') {
                                accumulated += chunk;
                                setMessages(prev =>
                                    prev.map(m => m.id === assistantId ? { ...m, content: accumulated } : m)
                                );
                            }
                        } catch { /* skip malformed line */ }
                    }
                }
            }
        } catch (err: any) {
            setMessages(prev =>
                prev.map(m => m.id === assistantId
                    ? { ...m, role: 'system' as const, content: `Fehler: ${err.message || 'Verbindung fehlgeschlagen'}` }
                    : m
                )
            );
        } finally {
            setIsLoading(false);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(input);
        }
    };

    const clearChat = () => {
        if (confirm('Chat-Verlauf löschen?')) setMessages([]);
    };

    const lastMsg       = messages[messages.length - 1];
    const showTyping    = isLoading && lastMsg?.role === 'assistant' && lastMsg?.content === '';

    return (
        // Use fixed positioning anchored to the right of the sidebar — bypasses all parent
        // padding / overflow-hidden constraints that would block pointer events.
        <div className="fixed inset-0 left-64 flex flex-col bg-background">

            {/* ── Header ──────────────────────────────────────────── */}
            <header className="shrink-0 flex items-center justify-between px-6 py-3.5 border-b bg-background/95 backdrop-blur-sm">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                        <Bot className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                        <p className="font-semibold text-sm leading-tight">Reanimator Agent</p>
                        <p className="text-[11px] text-muted-foreground leading-tight">Infrastructure Assistant</p>
                    </div>
                </div>

                {messages.length > 0 && (
                    <button
                        onClick={clearChat}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        Löschen
                    </button>
                )}
            </header>

            {/* ── Messages ────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto">
                {messages.length === 0 ? (
                    /* Empty state */
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
                    /* Message list */
                    <div className="py-8 px-4 space-y-6 max-w-4xl mx-auto">
                        {messages.map(m => (
                            <div key={m.id}>
                                {m.component === 'VMWizard' ? (
                                    <VMWizard
                                        onComplete={cmd => sendMessage(cmd)}
                                        onCancel={() => setMessages(prev => [...prev, {
                                            id: Date.now().toString(),
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

                        {/* Typing indicator */}
                        {showTyping && (
                            <div className="flex gap-3">
                                <div className="shrink-0 w-8 h-8 rounded-md bg-muted border border-border/50 flex items-center justify-center">
                                    <Bot className="w-4 h-4 text-muted-foreground" />
                                </div>
                                <div className="bg-muted rounded-xl px-4 py-3 flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]"   />
                                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
                                </div>
                            </div>
                        )}

                        <div ref={bottomRef} />
                    </div>
                )}
            </div>

            {/* ── Input ───────────────────────────────────────────── */}
            <div className="shrink-0 border-t bg-background/95 backdrop-blur-sm px-4 py-3">
                <div className="flex items-end gap-2 max-w-4xl mx-auto">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Nachricht schreiben… (Enter zum Senden, Shift+Enter für Zeilenumbruch)"
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
                            : <Send    className="w-4 h-4" />
                        }
                    </button>
                </div>
            </div>
        </div>
    );
}
