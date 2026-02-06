'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Terminal, Send, Bot, User, Sparkles, Loader2, Mail, Zap, Play, Globe } from "lucide-react";
import { useTranslations } from 'next-intl';
import { Input } from "@/components/ui/input";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

export default function ChatPage() {
    const t = useTranslations('common');
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const sendMessage = async (text: string) => {
        if (!text.trim() || isLoading) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: text.trim()
        };

        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [...messages, userMessage].map(m => ({
                        role: m.role,
                        content: m.content
                    }))
                })
            });

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(errorText || 'Anfrage fehlgeschlagen');
            }

            // Handle streaming response
            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            let assistantContent = '';

            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: ''
            };

            setMessages(prev => [...prev, assistantMessage]);

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n').filter(line => line.startsWith('0:'));
                    for (const line of lines) {
                        try {
                            const text = JSON.parse(line.slice(2));
                            if (typeof text === 'string') {
                                assistantContent += text;
                                setMessages(prev =>
                                    prev.map(m =>
                                        m.id === assistantMessage.id
                                            ? { ...m, content: assistantContent }
                                            : m
                                    )
                                );
                            }
                        } catch {
                            assistantContent += line.slice(2);
                            setMessages(prev =>
                                prev.map(m =>
                                    m.id === assistantMessage.id
                                        ? { ...m, content: assistantContent }
                                        : m
                                )
                            );
                        }
                    }
                }
            }
        } catch (error: any) {
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: `Fehler: ${error.message || 'Verbindung fehlgeschlagen.'}`
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        sendMessage(input);
    };

    return (
        <div className="h-[calc(100vh-1rem)] flex flex-col p-4 w-full">
            {/* Header */}
            <div className="flex items-center justify-between mb-4 px-2">
                <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-2 rounded-lg border border-primary/20">
                        <Sparkles className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">AI Operations Chat</h1>
                        <p className="text-xs text-muted-foreground">Autonome Administration & Analyse</p>
                    </div>
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 flex flex-col rounded-2xl border bg-muted/5 shadow-inner overflow-hidden relative">
                <ScrollArea className="flex-1 p-4 md:p-6">
                    <div className="space-y-6 max-w-5xl mx-auto pb-4">
                        {messages.length === 0 && (
                            <div className="text-center py-20 opacity-70 space-y-8">
                                <Bot className="h-16 w-16 mx-auto text-muted-foreground/30" />
                                <div className="space-y-2">
                                    <h2 className="text-2xl font-semibold">Wie kann ich helfen?</h2>
                                    <p className="text-sm text-muted-foreground">Ich kann Server verwalten, Fehler analysieren und Reports senden.</p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mx-auto">
                                    <Button variant="outline" className="h-auto py-4 flex flex-col gap-2 hover:border-primary/50 transition-all block text-left" onClick={() => sendMessage('Health Scan auf allen Servern')}>
                                        <div className="flex items-center gap-2 font-semibold">
                                            <Zap className="h-4 w-4 text-yellow-500" /> System Check
                                        </div>
                                        <p className="text-[10px] text-muted-foreground font-normal">Scanne alle Server auf Probleme</p>
                                    </Button>
                                    <Button variant="outline" className="h-auto py-4 flex flex-col gap-2 hover:border-primary/50 transition-all block text-left" onClick={() => sendMessage('Sende mir einen System-Report per Email')}>
                                        <div className="flex items-center gap-2 font-semibold">
                                            <Mail className="h-4 w-4 text-blue-500" /> Reporting
                                        </div>
                                        <p className="text-[10px] text-muted-foreground font-normal">Zusammenfassung per Email</p>
                                    </Button>
                                    <Button variant="outline" className="h-auto py-4 flex flex-col gap-2 hover:border-primary/50 transition-all block text-left" onClick={() => sendMessage('Analysiere Server Logs nach Fehlern')}>
                                        <div className="flex items-center gap-2 font-semibold">
                                            <Globe className="h-4 w-4 text-green-500" /> Log Analyse
                                        </div>
                                        <p className="text-[10px] text-muted-foreground font-normal">Logs autonom prüfen</p>
                                    </Button>
                                </div>
                            </div>
                        )}

                        {messages.map((m) => (
                            <div key={m.id} className={`flex gap-4 ${m.role === 'user' ? 'justify-end' : 'justify-start max-w-4xl'}`}>
                                {m.role !== 'user' && (
                                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20 mt-1">
                                        <Bot className="h-4 w-4 text-primary" />
                                    </div>
                                )}
                                <div className={`px-5 py-3.5 rounded-3xl text-sm leading-relaxed shadow-sm transition-all ${m.role === 'user'
                                    ? 'bg-primary text-primary-foreground rounded-tr-sm max-w-xl'
                                    : 'bg-card border border-border/50 rounded-tl-sm w-full'
                                    }`}>
                                    {m.role === 'user' ? (
                                        <div className="whitespace-pre-wrap font-sans">{m.content}</div>
                                    ) : (
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            className="prose prose-sm dark:prose-invert max-w-none break-words"
                                            components={{
                                                blockquote: ({ node, ...props }) => (
                                                    <div className="flex gap-2 my-3 pl-3 border-l-2 border-primary/30 bg-primary/5 p-2 rounded-r text-xs text-muted-foreground italic">
                                                        <Loader2 className="h-3 w-3 animate-spin self-center shrink-0 text-primary/50" />
                                                        <div className="opacity-80">{props.children}</div>
                                                    </div>
                                                ),
                                                code: ({ node, className, children, ...props }) => {
                                                    const match = /language-(\w+)/.exec(className || '');
                                                    return match ? (
                                                        <pre className="not-prose bg-zinc-950 text-zinc-100 p-3 rounded-lg overflow-x-auto my-2 text-xs font-mono border border-white/5 shadow-lg">
                                                            <code className={className} {...props}>
                                                                {children}
                                                            </code>
                                                        </pre>
                                                    ) : (
                                                        <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs font-medium border border-border" {...props}>
                                                            {children}
                                                        </code>
                                                    );
                                                },
                                            }}
                                        >
                                            {m.content}
                                        </ReactMarkdown>
                                    )}
                                </div>
                            </div>
                        ))}
                        {isLoading && messages[messages.length - 1]?.role === 'user' && (
                            <div className="flex gap-4">
                                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
                                    <Bot className="h-4 w-4 text-primary" />
                                </div>
                                <div className="px-4 py-2 bg-card border rounded-2xl rounded-tl-sm flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                    <span className="text-sm text-muted-foreground animate-pulse">Analysiere...</span>
                                </div>
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </div>
                </ScrollArea>

                {/* Input Area */}
                <div className="p-4 bg-background/80 backdrop-blur-md border-t">
                    <form onSubmit={handleSubmit} className="relative max-w-5xl mx-auto flex gap-3">
                        <Input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Frage etwas oder gib einen Befehl..."
                            className="bg-muted/30 shadow-none border-muted-foreground/20 focus-visible:ring-primary h-12 text-md pl-4 rounded-xl"
                            disabled={isLoading}
                        />
                        <Button type="submit" disabled={isLoading || !input.trim()} size="icon" className="shrink-0 h-12 w-12 rounded-xl bg-primary hover:bg-primary/90 transition-all shadow-lg hover:shadow-primary/20">
                            <Send className="h-5 w-5" />
                        </Button>
                    </form>
                </div>
            </div>
        </div>
    );
}
