/**
 * AI Agent chat page for the React SPA.
 * Communicates with POST /api/chat which streams SSE events.
 * Implements the same streaming protocol as the original Next.js route.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Loader2, Bot, User, ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ─── Types ────────────────────────────────────────────────────────────────────

const genId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
}

interface ToolCall {
  name: string;
  status: 'running' | 'done';
}

// ─── Tool pill component ──────────────────────────────────────────────────────

function ToolPill({ tool, status }: { tool: string; status: 'running' | 'done' }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      onClick={() => setOpen(!open)}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
        status === 'running'
          ? 'bg-primary/10 border-primary/20 text-primary animate-pulse'
          : 'bg-muted/50 border-border/50 text-muted-foreground'
      }`}
    >
      {status === 'running' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
      {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      {tool}
    </button>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${
        isUser ? 'bg-primary text-primary-foreground' : 'bg-muted border border-border'
      }`}>
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      <div className={`flex flex-col gap-1.5 max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1">
            {message.toolCalls.map((tc, i) => (
              <ToolPill key={i} tool={tc.name} status={tc.status} />
            ))}
          </div>
        )}

        {message.content && (
          <div className={`rounded-2xl px-4 py-2.5 text-sm ${
            isUser
              ? 'bg-primary text-primary-foreground rounded-tr-sm'
              : 'bg-muted border border-border/50 rounded-tl-sm'
          }`}>
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-2 prose-headings:my-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                {message.isStreaming && (
                  <span className="inline-block w-1.5 h-3.5 bg-current animate-pulse rounded-sm ml-0.5" />
                )}
              </div>
            )}
          </div>
        )}

        {message.isStreaming && !message.content && (
          <div className="bg-muted border border-border/50 rounded-2xl rounded-tl-sm px-4 py-3">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Agent page ───────────────────────────────────────────────────────────────

export default function AgentPage() {
  const { t } = useTranslation('agent');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const content = input.trim();
    if (!content || isStreaming) return;

    setInput('');
    setIsStreaming(true);

    const userMsg: Message = { id: genId(), role: 'user', content };
    const assistantMsg: Message = { id: genId(), role: 'assistant', content: '', toolCalls: [], isStreaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const historyForApi = messages.map((m) => ({ role: m.role, content: m.content }));

    abortRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...historyForApi, { role: 'user', content }],
          sessionId,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(Boolean);

        for (const line of lines) {
          const prefix = line[0];
          const jsonStr = line.slice(2); // skip "X:"

          try {
            switch (prefix) {
              case '0': {
                // Text content
                const text = JSON.parse(jsonStr);
                setMessages((prev) => prev.map((m) =>
                  m.id === assistantMsg.id ? { ...m, content: m.content + text } : m
                ));
                break;
              }
              case 's': {
                // Session ID
                const { id } = JSON.parse(jsonStr);
                setSessionId(id);
                break;
              }
              case 't': {
                // Tool start
                const toolName = JSON.parse(jsonStr);
                setMessages((prev) => prev.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, toolCalls: [...(m.toolCalls || []), { name: toolName, status: 'running' as const }] }
                    : m
                ));
                break;
              }
              case 'T': {
                // Tool end
                const toolName = JSON.parse(jsonStr);
                setMessages((prev) => prev.map((m) =>
                  m.id === assistantMsg.id
                    ? {
                        ...m,
                        toolCalls: (m.toolCalls || []).map((tc) =>
                          tc.name === toolName ? { ...tc, status: 'done' as const } : tc
                        ),
                      }
                    : m
                ));
                break;
              }
            }
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setMessages((prev) => prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: m.content || `Error: ${e.message}`, isStreaming: false }
            : m
        ));
      }
    } finally {
      setIsStreaming(false);
      setMessages((prev) => prev.map((m) =>
        m.id === assistantMsg.id ? { ...m, isStreaming: false } : m
      ));
    }
  }, [input, isStreaming, messages, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleAbort = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages((prev) => prev.map((m) => m.isStreaming ? { ...m, isStreaming: false } : m));
  };

  return (
    <div className="flex flex-col h-full -m-6">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <div className="bg-primary/10 border border-primary/20 p-2 rounded-xl">
          <Bot className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="font-semibold">{t('title', 'AI Agent')}</h1>
          <p className="text-xs text-muted-foreground">{t('subtitle', 'Infrastructure automation assistant')}</p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-12">
            <div className="bg-primary/10 border border-primary/20 p-4 rounded-2xl">
              <Bot className="h-8 w-8 text-primary" />
            </div>
            <div>
              <p className="font-medium">{t('greeting', 'How can I help you today?')}</p>
              <p className="text-sm text-muted-foreground mt-1">{t('greetingDesc', 'Ask me to manage VMs, check server health, run commands, and more.')}</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {[
                'Show all VMs on all servers',
                'Check server health',
                'List recent backups',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); }}
                  className="text-xs px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 border border-border/50 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-border/50 shrink-0">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('inputPlaceholder', 'Ask the AI agent...')}
            disabled={isStreaming}
            className="h-11"
            autoFocus
          />
          {isStreaming ? (
            <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={handleAbort}>
              <div className="h-3 w-3 rounded-sm bg-current" />
            </Button>
          ) : (
            <Button size="icon" className="h-11 w-11 shrink-0" onClick={sendMessage} disabled={!input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 text-center">
          Enter to send &bull; Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}
