'use client';

import { useState, useRef, useEffect } from 'react';
import { useChat } from 'ai/react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Bot, X, Send, Maximize2, Minimize2, Loader2, Sparkles } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export function AgentOverlay() {
    const [isOpen, setIsOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Core AI SDK hook
    const { messages, input, handleInputChange, handleSubmit, isLoading, reload, stop } = useChat({
        api: '/api/chat',
        onError: (err) => {
            console.error("AI Error", err);
        }
    });

    // Auto-scroll to bottom
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
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className={cn(
                            "bg-background border rounded-xl shadow-2xl flex flex-col overflow-hidden transition-all duration-300",
                            isExpanded ? "w-[80vw] h-[80vh] md:w-[800px] md:h-[700px]" : "w-[350px] h-[500px]"
                        )}
                    >
                        {/* Header */}
                        <div className="p-3 border-b flex items-center justify-between bg-muted/30">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-600/20">
                                    <Bot size={18} />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-sm">Reanimator AI</h3>
                                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                        Ollama Connected
                                    </p>
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
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth" ref={scrollRef}>
                            {messages.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground opacity-50">
                                    <Sparkles className="w-12 h-12 mb-4" />
                                    <p className="text-sm font-medium">How can I help you regarding your infrastructure?</p>
                                    <p className="text-xs mt-2">Try "List my nodes" or "Check backup status"</p>
                                </div>
                            )}

                            {messages.map(m => (
                                <ChatMessage key={m.id} role={m.role as any} content={m.content} toolInvocations={m.toolInvocations} />
                            ))}

                            {isLoading && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground p-4">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Thinking...
                                </div>
                            )}
                        </div>

                        {/* Input */}
                        <form onSubmit={handleSubmit} className="p-3 border-t bg-background flex gap-2">
                            <Input
                                value={input}
                                onChange={handleInputChange}
                                placeholder="Type a message..."
                                className="flex-1"
                                disabled={isLoading}
                            />
                            <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
                                <Send size={16} />
                            </Button>
                        </form>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Toggle Button */}
            {!isOpen && (
                <Button
                    onClick={() => setIsOpen(true)}
                    size="lg"
                    className="h-14 w-14 rounded-full shadow-2xl bg-emerald-600 hover:bg-emerald-700 text-white p-0 relative group animate-in slide-in-from-right-10 fade-in duration-500"
                >
                    <Bot size={28} className="group-hover:scale-110 transition-transform" />
                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-background" />
                </Button>
            )}
        </div>
    );
}

// Ensure framer-motion is installed
