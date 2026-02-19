'use client';

import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench, Bot, User, AlertTriangle, Copy, Check } from 'lucide-react';

interface ChatMessageProps {
    role: 'user' | 'assistant' | 'system' | 'data';
    content: string;
    timestamp?: number;
    toolInvocations?: any[];
}

export function ChatMessage({ role, content, timestamp, toolInvocations }: ChatMessageProps) {
    if (role === 'data') return null;
    if (!content?.trim()) return null;

    // Parse content for tool logs <<<TOOL:name:args>>>
    const parts = content.split(/(<<<TOOL:[^>]+>>>)/g);
    const hasOnlyToolLogs = parts.every(p => !p.trim() || p.startsWith('<<<TOOL:'));

    if (role === 'system') {
        return (
            <div className="flex justify-center py-2 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-full px-4 py-1.5 border border-border/50 shadow-sm">
                    <AlertTriangle className="w-3 h-3" />
                    <span>{content}</span>
                </div>
            </div>
        );
    }

    const isUser = role === 'user';

    return (
        <div className={cn(
            "flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300",
            isUser ? "ml-auto flex-row-reverse max-w-[85%]" : "mr-auto max-w-[85%]"
        )}>
            {/* Avatar */}
            <div className={cn(
                "shrink-0 w-9 h-9 rounded-full flex items-center justify-center mt-0.5 shadow-sm border",
                isUser
                    ? "bg-gradient-to-br from-primary to-primary/90 text-primary-foreground border-primary/20"
                    : "bg-gradient-to-br from-muted to-muted/80 border-border/50"
            )}>
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-muted-foreground" />}
            </div>

            {/* Message Bubble */}
            <div className={cn(
                "rounded-2xl px-5 py-3 text-sm leading-relaxed min-w-0 shadow-sm",
                isUser
                    ? "bg-gradient-to-br from-primary to-primary/95 text-primary-foreground rounded-tr-sm border border-primary/20"
                    : "bg-muted/80 backdrop-blur-sm rounded-tl-sm border border-border/50"
            )}>
                {isUser ? (
                    <span className="whitespace-pre-wrap break-words">{content}</span>
                ) : (
                    <div className={cn(
                        "prose prose-sm max-w-none dark:prose-invert",
                        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                        "prose-headings:font-semibold prose-headings:tracking-tight",
                        "prose-p:leading-relaxed",
                        "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
                        "prose-code:text-xs prose-code:font-mono",
                        "prose-pre:bg-[#0d0d0d] prose-pre:border prose-pre:border-border/30"
                    )}>
                        {parts.map((part, index) => {
                            if (part.startsWith('<<<TOOL:')) {
                                return <ToolLog key={index} raw={part} />;
                            }
                            if (!part.trim()) return null;
                            return (
                                <ReactMarkdown
                                    key={index}
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                        code: ({ node, className, children, ...props }) => {
                                            const match = /language-(\w+)/.exec(className || '');
                                            const isInline = !match;

                                            if (isInline) {
                                                return (
                                                    <code className="bg-background/60 px-1.5 py-0.5 rounded text-xs font-mono border border-border/30" {...props}>
                                                        {children}
                                                    </code>
                                                );
                                            }

                                            return (
                                                <CodeBlock
                                                    language={match[1]}
                                                    code={String(children).replace(/\n$/, '')}
                                                />
                                            );
                                        },
                                        ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 my-2">{children}</ul>,
                                        ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 my-2">{children}</ol>,
                                        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                                        p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
                                        h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-2">{children}</h1>,
                                        h2: ({ children }) => <h2 className="text-lg font-semibold mt-3 mb-2">{children}</h2>,
                                        h3: ({ children }) => <h3 className="text-base font-semibold mt-2 mb-1">{children}</h3>,
                                        blockquote: ({ children }) => (
                                            <blockquote className="border-l-4 border-primary/50 pl-4 italic text-muted-foreground my-2">
                                                {children}
                                            </blockquote>
                                        ),
                                        a: ({ children, href }) => (
                                            <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                                                {children}
                                            </a>
                                        ),
                                        table: ({ children }) => (
                                            <div className="my-2 overflow-x-auto">
                                                <table className="min-w-full border border-border/50 rounded-lg">
                                                    {children}
                                                </table>
                                            </div>
                                        ),
                                        th: ({ children }) => (
                                            <th className="border border-border/50 px-3 py-2 bg-muted/50 text-left font-semibold text-xs">
                                                {children}
                                            </th>
                                        ),
                                        td: ({ children }) => (
                                            <td className="border border-border/50 px-3 py-2 text-xs">
                                                {children}
                                            </td>
                                        ),
                                    }}
                                >
                                    {part}
                                </ReactMarkdown>
                            );
                        })}
                    </div>
                )}

                {/* Timestamp */}
                {timestamp && (
                    <div className={cn(
                        "text-[10px] mt-1.5 opacity-60",
                        isUser ? "text-primary-foreground/80" : "text-muted-foreground"
                    )}>
                        {new Date(timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                )}
            </div>
        </div>
    );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
    const [copied, setCopied] = useState(false);

    const copyCode = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="my-3 rounded-xl bg-[#0d0d0d] overflow-hidden border border-border/30 shadow-lg">
            <div className="px-4 py-2 bg-[#1a1a1a] text-[10px] font-medium text-muted-foreground border-b border-border/30 flex items-center justify-between">
                <span className="uppercase tracking-wide">{language}</span>
                <button
                    onClick={copyCode}
                    className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-muted/20 transition-colors text-muted-foreground hover:text-foreground"
                    title="Code kopieren"
                >
                    {copied ? (
                        <>
                            <Check className="w-3 h-3" />
                            <span>Kopiert!</span>
                        </>
                    ) : (
                        <>
                            <Copy className="w-3 h-3" />
                            <span>Kopieren</span>
                        </>
                    )}
                </button>
            </div>
            <div className="p-4 overflow-x-auto">
                <pre className="text-xs leading-relaxed">
                    <code className="font-mono text-gray-300">{code}</code>
                </pre>
            </div>
        </div>
    );
}

function ToolLog({ raw }: { raw: string }) {
    const [isOpen, setIsOpen] = useState(false);

    const content = raw.replace('<<<TOOL:', '').replace('>>>', '');
    const firstColon = content.indexOf(':');
    const name = content.substring(0, firstColon);
    const argsString = content.substring(firstColon + 1);

    let argsStrDisplay = argsString;
    try {
        const json = JSON.parse(argsString);
        argsStrDisplay = JSON.stringify(json, null, 2);
    } catch {}

    return (
        <div className="my-2 rounded-xl bg-gradient-to-br from-background/80 to-background/60 border border-border/50 overflow-hidden shadow-sm">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted/30 transition-colors text-left"
            >
                <div className={cn(
                    "transition-transform duration-200",
                    isOpen && "rotate-90"
                )}>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="shrink-0 w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Wrench className="w-3.5 h-3.5 text-primary" />
                </div>
                <span className="text-xs font-semibold text-foreground">{name}</span>
                <span className="text-[10px] text-muted-foreground ml-auto">Tool-Ausführung</span>
            </button>
            {isOpen && (
                <div className="px-4 py-3 border-t border-border/50 bg-muted/20">
                    <pre className="text-[10px] text-muted-foreground font-mono whitespace-pre-wrap overflow-x-auto leading-relaxed">
                        {argsStrDisplay}
                    </pre>
                </div>
            )}
        </div>
    );
}
