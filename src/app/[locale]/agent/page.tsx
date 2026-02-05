'use client';

import { useState, useRef, useEffect } from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Terminal, Send, Bot, User, Sparkles, Loader2 } from "lucide-react";
import { useTranslations } from 'next-intl';
import { Input } from "@/components/ui/input";

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

export default function CopilotPage() {
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
        <div className="h-[calc(100vh-2rem)] flex flex-col gap-4 p-4 max-w-5xl mx-auto w-full">
            <div className="flex items-center gap-4 mb-2">
                <div className="bg-gradient-to-br from-purple-500/20 to-blue-500/20 p-3 rounded-xl border border-purple-500/10">
                    <Sparkles className="h-8 w-8 text-purple-500" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Copilot</h1>
                    <p className="text-muted-foreground">Intelligente Unterstützung für Ihre Infrastruktur</p>
                </div>
            </div>

            <Card className="flex-1 overflow-hidden flex flex-col border-muted/60 shadow-md bg-background/50 backdrop-blur-sm">
                <ScrollArea className="flex-1 p-4">
                    <div className="space-y-6 max-w-3xl mx-auto">
                        {messages.length === 0 && (
                            <div className="text-center py-20 opacity-50 space-y-4">
                                <Bot className="h-16 w-16 mx-auto text-muted-foreground/50" />
                                <p className="text-lg">Wie kann ich Ihnen helfen?</p>
                                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                                    Ich kann Server-Status abfragen, Backups überprüfen und bei der Fehlerbehebung unterstützen.
                                </p>
                                <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto pt-4">
                                    <Button variant="outline" className="text-xs" onClick={() => sendMessage('Zeige mir den Status aller Server')}>
                                        Server-Status
                                    </Button>
                                    <Button variant="outline" className="text-xs" onClick={() => sendMessage('Gibt es fehlgeschlagene Backups?')}>
                                        Backup-Prüfung
                                    </Button>
                                    <Button variant="outline" className="text-xs" onClick={() => sendMessage('Liste die letzten 5 Backups')}>
                                        Letzte Backups
                                    </Button>
                                </div>
                            </div>
                        )}

                        {messages.map((m) => (
                            <div key={m.id} className={`flex gap-4 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                {m.role !== 'user' && (
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center shrink-0 border border-purple-500/20">
                                        <Bot className="h-4 w-4 text-purple-500" />
                                    </div>
                                )}
                                <div className={`px-4 py-2.5 rounded-2xl max-w-[85%] text-sm leading-relaxed shadow-sm ${m.role === 'user'
                                    ? 'bg-primary text-primary-foreground rounded-tr-none'
                                    : 'bg-muted/80 border rounded-tl-none'
                                    }`}>
                                    <div className="whitespace-pre-wrap font-sans">{m.content}</div>
                                </div>
                                {m.role === 'user' && (
                                    <div className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center shrink-0 border">
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
                                <div className="px-4 py-2 bg-muted/50 rounded-2xl rounded-tl-none flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                                    <span className="text-sm text-muted-foreground">Denke nach...</span>
                                </div>
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </div>
                </ScrollArea>
                <div className="p-4 bg-muted/30 border-t backdrop-blur-sm">
                    <form onSubmit={handleSubmit} className="relative max-w-3xl mx-auto flex gap-2">
                        <Input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Stellen Sie eine Frage..."
                            className="bg-background shadow-sm border-muted-foreground/20 focus-visible:ring-purple-500"
                            disabled={isLoading}
                        />
                        <Button type="submit" disabled={isLoading || !input.trim()} size="icon" className="shrink-0 bg-purple-600 hover:bg-purple-700">
                            <Send className="h-4 w-4" />
                        </Button>
                    </form>
                    <p className="text-[10px] text-center mt-2 text-muted-foreground opacity-60">
                        Antworten können ungenau sein. Wichtige Aktionen immer verifizieren.
                    </p>
                </div>
            </Card>
        </div>
    );
}
