// @ts-nocheck
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Maximize2, Minimize2, RotateCcw, Terminal } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

interface TerminalClientProps {
    wsUrl: string;
    serverName: string;
    vmid: string;
}

export default function TerminalClient({ wsUrl, serverName, vmid }: TerminalClientProps) {
    const t = useTranslations('console');
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<any>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const fitAddonRef = useRef<any>(null);
    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const [isFullscreen, setIsFullscreen] = useState(false);

    const connect = useCallback(async () => {
        if (!terminalRef.current) return;

        setStatus('connecting');

        // Dynamic imports for xterm (client-side only)
        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        const { WebLinksAddon } = await import('@xterm/addon-web-links');

        // Dispose previous terminal if exists
        if (xtermRef.current) {
            xtermRef.current.dispose();
        }

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Menlo, Monaco, 'Courier New', monospace",
            theme: {
                background: '#0a0a0a',
                foreground: '#e4e4e7',
                cursor: '#e4e4e7',
                selectionBackground: '#3f3f46',
                black: '#09090b',
                red: '#ef4444',
                green: '#22c55e',
                yellow: '#eab308',
                blue: '#3b82f6',
                magenta: '#a855f7',
                cyan: '#06b6d4',
                white: '#e4e4e7',
                brightBlack: '#52525b',
                brightRed: '#f87171',
                brightGreen: '#4ade80',
                brightYellow: '#facc15',
                brightBlue: '#60a5fa',
                brightMagenta: '#c084fc',
                brightCyan: '#22d3ee',
                brightWhite: '#fafafa',
            },
            allowProposedApi: true,
        });

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();

        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);

        // Clear container and open terminal
        terminalRef.current.innerHTML = '';
        term.open(terminalRef.current);
        fitAddon.fit();

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        // Build absolute WebSocket URL
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const fullWsUrl = `${protocol}//${window.location.host}${wsUrl}`;

        const ws = new WebSocket(fullWsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('[Terminal] WebSocket connected');
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'output') {
                    term.write(msg.data);
                } else if (msg.type === 'status') {
                    setStatus(msg.status === 'connected' ? 'connected' : 'disconnected');
                }
            } catch {
                // Raw data fallback
                term.write(event.data);
            }
        };

        ws.onclose = (event) => {
            console.log(`[Terminal] WebSocket closed: ${event.code} ${event.reason}`);
            setStatus('disconnected');
            term.write('\r\n\x1b[31m--- Connection closed ---\x1b[0m\r\n');
        };

        ws.onerror = () => {
            setStatus('disconnected');
        };

        // Terminal input → WebSocket
        term.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'input', data }));
            }
        });

        // Handle resize
        const sendResize = () => {
            fitAddon.fit();
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'resize',
                    cols: term.cols,
                    rows: term.rows,
                }));
            }
        };

        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(sendResize);
        });
        resizeObserver.observe(terminalRef.current);

        // Cleanup
        return () => {
            resizeObserver.disconnect();
            ws.close();
            term.dispose();
        };
    }, [wsUrl]);

    useEffect(() => {
        let cleanup: (() => void) | undefined;
        connect().then((fn) => { cleanup = fn; });
        return () => { cleanup?.(); };
    }, [connect]);

    const handleReconnect = () => {
        // Close existing connection
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        connect();
    };

    const toggleFullscreen = () => {
        const container = terminalRef.current?.parentElement?.parentElement;
        if (!container) return;

        if (!isFullscreen) {
            container.requestFullscreen?.();
        } else {
            document.exitFullscreen?.();
        }
        setIsFullscreen(!isFullscreen);

        // Refit after fullscreen change
        setTimeout(() => {
            fitAddonRef.current?.fit();
        }, 200);
    };

    // Listen for fullscreen changes
    useEffect(() => {
        const handler = () => {
            setIsFullscreen(!!document.fullscreenElement);
            setTimeout(() => fitAddonRef.current?.fit(), 200);
        };
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    const statusColor = {
        connecting: 'bg-yellow-500',
        connected: 'bg-green-500',
        disconnected: 'bg-red-500',
    }[status];

    const statusText = {
        connecting: 'Connecting...',
        connected: t('connected'),
        disconnected: t('disconnected'),
    }[status];

    return (
        <div className="flex flex-col h-full bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800">
                <div className="flex items-center gap-3">
                    <Terminal className="h-4 w-4 text-zinc-400" />
                    <span className="text-sm font-medium text-zinc-300">
                        {serverName} / VM {vmid}
                    </span>
                    <Badge variant="outline" className="gap-1.5 text-xs">
                        <span className={`h-2 w-2 rounded-full ${statusColor}`} />
                        {statusText}
                    </Badge>
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleReconnect}
                        disabled={status === 'connecting'}
                        className="h-7 text-xs text-zinc-400 hover:text-zinc-200"
                    >
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />
                        {t('reconnect')}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleFullscreen}
                        className="h-7 text-xs text-zinc-400 hover:text-zinc-200"
                    >
                        {isFullscreen ? (
                            <Minimize2 className="h-3.5 w-3.5" />
                        ) : (
                            <Maximize2 className="h-3.5 w-3.5" />
                        )}
                    </Button>
                </div>
            </div>

            {/* Terminal */}
            <div
                ref={terminalRef}
                className="flex-1 min-h-0 p-1"
                style={{ minHeight: '400px' }}
            />
        </div>
    );
}
