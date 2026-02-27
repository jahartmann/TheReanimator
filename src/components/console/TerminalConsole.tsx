'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getConsoleAccess } from '@/lib/actions/console';
import { Loader2 } from 'lucide-react';

interface TerminalConsoleProps {
    serverId: number;
    vmid: number;
    vmType: 'qemu' | 'lxc';
    onConnect?: () => void;
    onDisconnect?: () => void;
}

export function TerminalConsole({ serverId, vmid, vmType, onConnect, onDisconnect }: TerminalConsoleProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<any>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const fitAddonRef = useRef<any>(null);
    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
    const [error, setError] = useState<string | null>(null);

    const connect = useCallback(async () => {
        if (!containerRef.current) return;
        setStatus('connecting');
        setError(null);

        try {
            const { sessionToken, wsPort } = await getConsoleAccess(serverId, vmid, vmType, 'terminal');

            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsHost = window.location.hostname;
            const wsUrl = `${wsProtocol}//${wsHost}:${wsPort}/console?token=${sessionToken}`;

            // Dynamic imports
            const { Terminal } = await import('@xterm/xterm');
            const { FitAddon } = await import('@xterm/addon-fit');
            const { WebLinksAddon } = await import('@xterm/addon-web-links');

            // Load xterm CSS
            if (!document.querySelector('link[href*="xterm.css"]')) {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = '/node_modules/@xterm/xterm/css/xterm.css';
                document.head.appendChild(link);
            }

            // Clean up previous
            if (termRef.current) {
                termRef.current.dispose();
                termRef.current = null;
            }
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            containerRef.current.innerHTML = '';

            // Create terminal
            const term = new Terminal({
                cursorBlink: true,
                fontSize: 14,
                fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
                theme: {
                    background: '#0a0a0a',
                    foreground: '#e4e4e7',
                    cursor: '#e4e4e7',
                    selectionBackground: '#3f3f46',
                    black: '#18181b',
                    red: '#ef4444',
                    green: '#22c55e',
                    yellow: '#eab308',
                    blue: '#3b82f6',
                    magenta: '#a855f7',
                    cyan: '#06b6d4',
                    white: '#e4e4e7',
                },
                allowProposedApi: true
            });

            const fitAddon = new FitAddon();
            const webLinksAddon = new WebLinksAddon();
            term.loadAddon(fitAddon);
            term.loadAddon(webLinksAddon);

            term.open(containerRef.current);
            fitAddon.fit();
            fitAddonRef.current = fitAddon;

            // WebSocket connection
            const ws = new WebSocket(wsUrl, ['binary']);
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {
                setStatus('connected');
                onConnect?.();
                // Send initial resize
                const dims = fitAddon.proposeDimensions();
                if (dims) {
                    ws.send(`1:${dims.cols}:${dims.rows}:`);
                }
            };

            ws.onmessage = (event) => {
                if (typeof event.data === 'string') {
                    term.write(event.data);
                } else {
                    term.write(new Uint8Array(event.data));
                }
            };

            ws.onclose = () => {
                setStatus('disconnected');
                onDisconnect?.();
                term.write('\r\n\x1b[31m--- Connection closed ---\x1b[0m\r\n');
            };

            ws.onerror = () => {
                setStatus('error');
                setError('WebSocket connection failed');
                onDisconnect?.();
            };

            // Terminal input -> WebSocket
            // Proxmox termproxy expects "0:LENGTH:DATA" format
            term.onData((data: string) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(`0:${data.length}:${data}`);
                }
            });

            // Handle resize
            term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(`1:${cols}:${rows}:`);
                }
            });

            // Window resize -> fit terminal
            const handleResize = () => fitAddon.fit();
            window.addEventListener('resize', handleResize);

            termRef.current = term;
            wsRef.current = ws;

            // Store cleanup for resize listener
            (containerRef.current as any).__resizeCleanup = () => {
                window.removeEventListener('resize', handleResize);
            };

        } catch (err) {
            setStatus('error');
            setError(err instanceof Error ? err.message : 'Failed to connect');
            onDisconnect?.();
        }
    }, [serverId, vmid, vmType, onConnect, onDisconnect]);

    useEffect(() => {
        connect();
        return () => {
            if (termRef.current) termRef.current.dispose();
            if (wsRef.current) wsRef.current.close();
            if (containerRef.current && (containerRef.current as any).__resizeCleanup) {
                (containerRef.current as any).__resizeCleanup();
            }
        };
    }, [connect]);

    return (
        <div className="relative h-full w-full">
            {status === 'connecting' && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                    <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <span className="text-sm text-muted-foreground">Connecting to terminal...</span>
                    </div>
                </div>
            )}
            {status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                    <div className="flex flex-col items-center gap-2 text-center p-4">
                        <span className="text-sm text-destructive">{error}</span>
                        <button onClick={connect} className="text-sm text-primary hover:underline">
                            Retry connection
                        </button>
                    </div>
                </div>
            )}
            <div ref={containerRef} className="h-full w-full" />
        </div>
    );
}
