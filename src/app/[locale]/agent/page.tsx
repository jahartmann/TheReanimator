'use client';

import { useChat } from '@ai-sdk/react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Terminal, Send, Bot, User, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from "@/components/ui/input";

export default function AgentPage() {
    const t = useTranslations('common');
    const chatHelpers = useChat() as any; // Cast to any to avoid strict type issues
    const { messages, sendMessage, status } = chatHelpers;
    const [input, setInput] = useState('');
    const bottomRef = useRef<HTMLDivElement>(null);
    const isLoading = status === 'streaming' || status === 'submitted';

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!input.trim() || isLoading) return;

        const currentInput = input;
        setInput('');

        await sendMessage({ text: currentInput });
    };

    const sendQuickMessage = async (content: string) => {
        await sendMessage({ text: content });
    };

    // Helper to get message text content
    const getMessageContent = (m: any) => {
        if (typeof m.content === 'string') return m.content;
        if (Array.isArray(m.parts)) {
            return m.parts
                .filter((p: any) => p.type === 'text')
                .map((p: any) => p.text)
                .join('');
        }
        return '';
    };

    return (
        <div className="h-[calc(100vh-2rem)] flex flex-col gap-4 p-4 max-w-5xl mx-auto w-full">
            <div className="flex items-center gap-4 mb-2">
                <div className="bg-purple-500/10 p-3 rounded-xl">
                    <Sparkles className="h-8 w-8 text-purple-500" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Reanimator AI</h1>
                    <p className="text-muted-foreground">Ihr persönlicher System-Administrator Assistent.</p>
                </div>
            </div>

            <Card className="flex-1 overflow-hidden flex flex-col border-muted/60 shadow-md bg-background/50 backdrop-blur-sm">
                <ScrollArea className="flex-1 p-4">
                    <div className="space-y-6 max-w-3xl mx-auto">
                        {messages.length === 0 && (
                            <div className="text-center py-20 opacity-50 space-y-4">
                                <Bot className="h-16 w-16 mx-auto text-muted-foreground/50" />
                                <p>Wie kann ich Ihnen heute helfen?</p>
                                <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                                    <Button variant="outline" className="text-xs" onClick={() => sendQuickMessage('Zeige Server Status')}>
                                        Zeige Server Status
                                    </Button>
                                    <Button variant="outline" className="text-xs" onClick={() => sendQuickMessage('Habe ich fehlgeschlagene Backups?')}>
                                        Fehlgeschlagene Backups?
                                    </Button>
                                </div>
                            </div>
                        )}

                        {messages.map((m: any) => (
                            <div key={m.id} className={`flex gap-4 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                {m.role !== 'user' && (
                                    <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0 border border-purple-500/20">
                                        <Bot className="h-4 w-4 text-purple-500" />
                                    </div>
                                )}
                                <div className={`px-4 py-2.5 rounded-2xl max-w-[85%] text-sm leading-relaxed shadow-sm ${m.role === 'user'
                                    ? 'bg-primary text-primary-foreground rounded-tr-none'
                                    : 'bg-muted/80 border rounded-tl-none'
                                    }`}>
                                    <div className="whitespace-pre-wrap font-sans">{getMessageContent(m)}</div>
                                    {m.parts?.filter((p: any) => p.type === 'tool-invocation').map((toolPart: any) => {
                                        const toolCallId = toolPart.toolInvocation?.toolCallId || toolPart.toolCallId;
                                        const toolResult = toolPart.toolInvocation?.result;

                                        if (!toolResult) {
                                            return (
                                                <div key={toolCallId} className="mt-2 p-2 bg-background/50 rounded border text-xs font-mono text-muted-foreground flex items-center gap-2">
                                                    <Terminal className="h-3 w-3" />
                                                    Calling {toolPart.toolInvocation?.toolName || 'tool'}...
                                                </div>
                                            );
                                        }

                                        return (
                                            <div key={toolCallId} className="mt-2 p-2 bg-green-500/10 rounded border border-green-500/20 text-xs font-mono text-green-600 dark:text-green-400 overflow-x-auto">
                                                <pre>{JSON.stringify(toolResult, null, 2)}</pre>
                                            </div>
                                        );
                                    })}
                                </div>
                                {m.role === 'user' && (
                                    <div className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center shrink-0 border">
                                        <User className="h-4 w-4 text-secondary-foreground" />
                                    </div>
                                )}
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex gap-4">
                                <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0 border border-purple-500/20">
                                    <Bot className="h-4 w-4 text-purple-500" />
                                </div>
                                <div className="px-4 py-2 bg-muted/50 rounded-2xl rounded-tl-none flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                    <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                    <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce"></span>
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
                            placeholder="Fragen Sie etwas..."
                            className="bg-background shadow-sm border-muted-foreground/20 focus-visible:ring-purple-500"
                        />
                        <Button type="submit" disabled={isLoading || !input.trim()} size="icon" className="shrink-0 bg-purple-600 hover:bg-purple-700">
                            <Send className="h-4 w-4" />
                        </Button>
                    </form>
                    <p className="text-[10px] text-center mt-2 text-muted-foreground opacity-60">
                        AI can make mistakes. Verify important actions.
                    </p>
                </div>
            </Card>
        </div>
    );
}
