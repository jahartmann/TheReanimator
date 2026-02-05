'use client';

import { cn } from '@/lib/utils';
import { User, Bot, Terminal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface ChatMessageProps {
    role: 'user' | 'assistant' | 'system' | 'data';
    content: string;
    toolInvocations?: any[];
}

export function ChatMessage({ role, content, toolInvocations }: ChatMessageProps) {
    if (role === 'system' || role === 'data') return null;

    return (
        <div className={cn(
            "flex gap-3 text-sm p-4 rounded-lg animate-in fade-in slide-in-from-bottom-2",
            role === 'user' ? "bg-muted/50" : "bg-background border"
        )}>
            <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                role === 'user' ? "bg-primary text-primary-foreground" : "bg-emerald-600 text-white"
            )}>
                {role === 'user' ? <User size={16} /> : <Bot size={16} />}
            </div>

            <div className="flex-1 space-y-2 overflow-hidden">
                <div className="prose prose-sm dark:prose-invert break-words">
                    <ReactMarkdown>{content}</ReactMarkdown>
                </div>

                {toolInvocations && toolInvocations.map((toolInvocation, index) => (
                    <div key={index} className="flex items-center gap-2 p-2 bg-muted/50 rounded text-xs font-mono text-muted-foreground border mt-2">
                        <Terminal size={12} />
                        <span>Called {toolInvocation.toolName}</span>
                        {toolInvocation.state === 'result' && (
                            <span className="text-emerald-500">✓ Done</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
