'use client';

import { useState, useRef, useEffect } from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Terminal, Send, Bot, User, Sparkles, Loader2, Mail } from "lucide-react";
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
                    // Parse SSE data
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
                            // Try plain text
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

            // If no content was streamed, show error
            if (!assistantContent) {
                setMessages(prev =>
                    prev.map(m =>
                        m.id === assistantMessage.id
                            ? { ...m, content: 'Keine Antwort erhalten. Bitte überprüfen Sie die Ollama-Verbindung in den Einstellungen.' }
                            : m
                    )
                );
            }
        } catch (error: any) {
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: `Fehler: ${error.message || 'Verbindung zum AI-Service fehlgeschlagen. Bitte überprüfen Sie die Einstellungen.'}`
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
        <div className="h-[calc(100vh-2rem)] flex flex-col gap-4 p-4 max-w-6xl mx-auto w-full">
            <div className="flex items-center gap-4 mb-2">
                <div className="bg-gradient-to-br from-purple-500/20 to-blue-500/20 p-3 rounded-xl border border-purple-500/10 shadow-sm">
                    <Sparkles className="h-6 w-6 text-purple-500" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Chat</h1>
                    <p className="text-sm text-muted-foreground">Intelligente Automatisierung & Analyse</p>
                </div>
            </div>

            <Card className="flex-1 overflow-hidden flex flex-col border-muted/40 shadow-sm bg-background/50 backdrop-blur-sm">
                <ScrollArea className="flex-1 p-4">
                    <div className="space-y-6 max-w-4xl mx-auto pb-4">
                        {messages.length === 0 && (
                            <div className="text-center py-20 opacity-60 space-y-6">
                                <div className="bg-muted/30 p-6 rounded-full w-24 h-24 mx-auto flex items-center justify-center">
                                    <Bot className="h-10 w-10 text-primary/50" />
                                </div>
                                <div className="space-y-2">
                                    <p className="text-xl font-medium">Reanimator Intelligence 2.0</p>
                                    <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                                        Ich kann autonom Befehle ausführen, System-Checks durchführen, Emails senden und komplexe Probleme lösen.
                                    </p>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto pt-4">
                                    <Button variant="outline" className="h-auto py-3 px-4 justify-start gap-3 bg-background/50" onClick={() => sendMessage('Führe einen Health-Check auf allen Servern durch')}>
                                        <div className="bg-green-500/10 p-1.5 rounded-md">
                                            <Sparkles className="h-4 w-4 text-green-500" />
                                        </div>
                                        <div className="text-left">
                                            <div className="text-xs font-semibold">Health Scan</div>
                                            <div className="text-[10px] text-muted-foreground">Systemdiagnose starten</div>
                                        </div>
                                    </Button>
                                    <Button variant="outline" className="h-auto py-3 px-4 justify-start gap-3 bg-background/50" onClick={() => sendMessage('Schicke mir einen System-Report per Email')}>
                                        <div className="bg-blue-500/10 p-1.5 rounded-md">
                                            <Mail className="h-4 w-4 text-blue-500" />
                                        </div>
                                        <div className="text-left">
                                            <div className="text-xs font-semibold">Email Report</div>
                                            <div className="text-[10px] text-muted-foreground">Infos zusammenfassen</div>
                                        </div>
                                    </Button>
                                    <Button variant="outline" className="h-auto py-3 px-4 justify-start gap-3 bg-background/50" onClick={() => sendMessage('Analysiere das Netzwerk auf Fehler')}>
                                        <div className="bg-amber-500/10 p-1.5 rounded-md">
                                            <Terminal className="h-4 w-4 text-amber-500" />
                                        </div>
                                        <div className="text-left">
                                            <div className="text-xs font-semibold">Netzwerk Analyse</div>
                                            <div className="text-[10px] text-muted-foreground">Verbindungsprobleme finden</div>
                                        </div>
                                    </Button>
                                </div>
                            </div>
                        )}

                        {messages.map((m) => (
                            <div key={m.id} className={`flex gap-4 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                {m.role !== 'user' && (
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center shrink-0 border border-purple-500/20 mt-1">
                                        <Bot className="h-4 w-4 text-purple-500" />
                                    </div>
                                )}
                                <div className={`px-5 py-3.5 rounded-3xl max-w-[85%] text-sm leading-relaxed shadow-sm transition-all ${m.role === 'user'
                                    ? 'bg-primary text-primary-foreground rounded-tr-sm'
                                    : 'bg-muted/40 border border-border/50 rounded-tl-sm'
                                    }`}>
                                    {m.role === 'user' ? (
                                        <div className="whitespace-pre-wrap font-sans">{m.content}</div>
                                    ) : (
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            className="prose prose-sm dark:prose-invert max-w-none break-words"
                                            components={{
                                                // Style "Thinking" blocks (blockquotes in streaming)
                                                blockquote: ({ node, ...props }) => (
                                                    <div className="flex gap-2 my-3 pl-3 border-l-2 border-purple-500/30 bg-purple-500/5 p-2 rounded-r text-xs text-muted-foreground italic">
                                                        <Loader2 className="h-3 w-3 animate-spin self-center shrink-0 text-purple-500/50" />
                                                        <div className="opacity-80">{props.children}</div>
                                                    </div>
                                                ),
                                                // Style Code Blocks
                                                code: ({ node, className, children, ...props }) => {
                                                    const match = /language-(\w+)/.exec(className || '');
                                                    return match ? (
                                                        <pre className="not-prose bg-black/80 text-white p-3 rounded-lg overflow-x-auto my-2 text-xs font-mono border border-white/10 shadow-inner">
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
                                                // Style lists
                                                ul: ({ node, ...props }) => <ul className="list-disc pl-5 my-2 space-y-1" {...props} />,
                                                ol: ({ node, ...props }) => <ol className="list-decimal pl-5 my-2 space-y-1" {...props} />,
                                                // Links
                                                a: ({ node, ...props }) => <a className="text-primary hover:underline font-medium" {...props} target="_blank" rel="noopener noreferrer" />,
                                                // Tables
                                                table: ({ node, ...props }) => <div className="overflow-x-auto my-4"><table className="min-w-full divide-y divide-border border rounded-lg" {...props} /></div>,
                                                th: ({ node, ...props }) => <th className="px-3 py-2 bg-muted/50 text-left text-xs font-medium uppercase tracking-wider" {...props} />,
                                                td: ({ node, ...props }) => <td className="px-3 py-2 border-t border-border/50 text-xs" {...props} />,
                                            }}
                                        >
                                            {m.content}
                                        </ReactMarkdown>
                                    )}
                                </div>
                                {m.role === 'user' && (
                                    <div className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center shrink-0 border mt-1">
                                        <User className="h-4 w-4 text-secondary-foreground" />
                                    </div>
                                )}
                            </div>
                        ))}
                        {isLoading && messages[messages.length - 1]?.role === 'user' && (
                            <div className="flex gap-4">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center shrink-0 border border-purple-500/20">
                                    <Bot className="h-4 w-4 text-purple-500" />
                                </div>
                                <div className="px-4 py-2 bg-muted/30 rounded-2xl rounded-tl-sm flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                                    <span className="text-sm text-muted-foreground animate-pulse">Analysiere...</span>
                                </div>
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </div>
                </ScrollArea>
                <div className="p-4 bg-muted/20 border-t backdrop-blur-sm">
                    <form onSubmit={handleSubmit} className="relative max-w-4xl mx-auto flex gap-2">
                        <Input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Frage stellen oder Befehl geben..."
                            className="bg-background shadow-sm border-muted-foreground/10 focus-visible:ring-purple-500 h-11"
                            disabled={isLoading}
                        />
                        <Button type="submit" disabled={isLoading || !input.trim()} size="icon" className="shrink-0 bg-purple-600 hover:bg-purple-700 h-11 w-11 transition-all shadow-md shadow-purple-900/10">
                            <Send className="h-4 w-4" />
                        </Button>
                    </form>
                    <p className="text-[10px] text-center mt-3 text-muted-foreground opacity-50">
                        Autonome Aktionen werden im Audit-Log gespeichert.
                    </p>
                </div>
            </Card>
        </div>
    );
}
