'use client';

import { useState, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { Button } from '@/components/ui/button';
import { Bot, X, Send, Maximize2, Minimize2, Loader2, Sparkles } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { cn } from '@/lib/utils';
// @ts-ignore
import { motion, AnimatePresence } from 'framer-motion';

export function AgentOverlay() {
    const [isOpen, setIsOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

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

    return (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-4">
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        transition={{ duration: 0.15 }}
                        className={cn(
                            "bg-background border rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-300",
                            isExpanded ? "w-[80vw] h-[80vh] md:w-[700px] md:h-[600px]" : "w-[380px] h-[520px]"
                        )}
                    >
                        {/* Header */}
                        <div className="px-4 py-3 border-b flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                                    <Bot size={16} className="text-primary" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-sm leading-none">Reanimator AI</h3>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">Infrastructure Assistant</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsExpanded(!isExpanded)}>
                                    {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsOpen(false)}>
                                    <X size={14} />
                                </Button>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth" ref={scrollRef}>
                            {messages.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
                                    <Sparkles className="w-10 h-10 mb-3 opacity-30" />
                                    <p className="text-sm font-medium">How can I help?</p>
                                    <p className="text-xs mt-1 opacity-60">Ask about servers, VMs, or backups</p>
                                </div>
                            )}

                            {messages.map((m: any) => (
                                <ChatMessage key={m.id} role={m.role} content={m.content} toolInvocations={m.toolInvocations} timestamp={m.createdAt ? new Date(m.createdAt).getTime() : Date.now()} />
                            ))}

                            {isLoading && (
                                <div className="flex gap-3 mr-auto">
                                    <div className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                                        <Bot className="w-4 h-4" />
                                    </div>
                                    <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3">
                                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Input */}
                        <form onSubmit={handleInternalSubmit} className="p-3 border-t flex gap-2">
                            <input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="Type a message..."
                                className="flex-1 bg-muted/50 rounded-xl px-3 py-2 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary/50"
                                disabled={isLoading}
                            />
                            <Button type="submit" size="icon" className="h-9 w-9 rounded-xl" disabled={isLoading || !input.trim()}>
                                <Send size={14} />
                            </Button>
                        </form>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Toggle Button */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="h-12 w-12 rounded-full shadow-lg bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 transition-opacity"
                >
                    <Bot size={22} />
                </button>
            )}
        </div>
    );
}
