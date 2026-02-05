'use client';

import { useChat } from 'ai/react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Terminal, Send, Bot, User, Sparkles } from "lucide-react";
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from "@/components/ui/input";

export default function AgentPage() {
    const t = useTranslations('common');
    const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
        api: '/api/chat',
    });
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

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
                                    <Button variant="outline" className="text-xs" onClick={() => handleInputChange({ target: { value: 'Zeige Server Status' } } as any)}>
                                        Zeige Server Status
                                    </Button>
                                    <Button variant="outline" className="text-xs" onClick={() => handleInputChange({ target: { value: 'Habe ich fehlgeschlagene Backups?' } } as any)}>
                                        Fehlgeschlagene Backups?
                                    </Button>
                                </div>
                            </div>
                        )}

                        {messages.map(m => (
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
                                    <div className="whitespace-pre-wrap font-sans">{m.content}</div>
                                    {m.toolInvocations?.map((toolInvocation: any) => {
                                        const toolCallId = toolInvocation.toolCallId;
                                        const addResult = toolInvocation.result;

                                        // render confirmation attempt (tool not executed yet)
                                        if (!addResult) {
                                            return (
                                                <div key={toolCallId} className="mt-2 p-2 bg-background/50 rounded border text-xs font-mono text-muted-foreground flex items-center gap-2">
                                                    <Terminal className="h-3 w-3" />
                                                    Calling {toolInvocation.toolName}...
                                                </div>
                                            );
                                        }

                                        // render result
                                        return (
                                            <div key={toolCallId} className="mt-2 p-2 bg-green-500/10 rounded border border-green-500/20 text-xs font-mono text-green-600 dark:text-green-400 overflow-x-auto">
                                                {'result' in toolInvocation ? (
                                                    <pre>{JSON.stringify(toolInvocation.result, null, 2)}</pre>
                                                ) : null}
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
                            onChange={handleInputChange}
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
