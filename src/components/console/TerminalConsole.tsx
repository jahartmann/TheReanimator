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
    const cleanupRef = useRef<(() => void) | null>(null);
    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
    const [error, setError] = useState<string | null>(null);

    const connect = useCallback(async () => {
        if (!containerRef.current) return;
        setStatus('connecting');
        setError(null);

        try {
            // Get SSH session token from server
            const { sessionToken, wsPort } = await getConsoleAccess(serverId, vmid, vmType, 'terminal');

            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsHost = window.location.hostname;
            const wsUrl = `${wsProtocol}//${wsHost}:${wsPort}/console?token=${sessionToken}`;

            // Dynamic imports (avoid SSR issues)
            const [
                { Terminal },
                { FitAddon },
                { WebLinksAddon }
            ] = await Promise.all([
                import('@xterm/xterm'),
                import('@xterm/addon-fit'),
                import('@xterm/addon-web-links'),
            ]);

            // xterm CSS is loaded globally via globals.css (@import "@xterm/xterm/css/xterm.css")

            // Clean up previous instances
            if (termRef.current) {
                termRef.current.dispose();
                termRef.current = null;
            }
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            if (cleanupRef.current) {
                cleanupRef.current();
                cleanupRef.current = null;
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
                allowProposedApi: true,
            });

            const fitAddon = new FitAddon();
            const webLinksAddon = new WebLinksAddon();
            term.loadAddon(fitAddon);
            term.loadAddon(webLinksAddon);

            term.open(containerRef.current);
            fitAddon.fit();
            fitAddonRef.current = fitAddon;

            // WebSocket connection (no subprotocol — raw SSH data)
            const ws = new WebSocket(wsUrl);
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {
                setStatus('connected');
                onConnect?.();

                // Send initial resize
                const dims = fitAddon.proposeDimensions();
                if (dims) {
                    ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
                }
            };

            ws.onmessage = (event) => {
                // SSH output arrives as binary (ArrayBuffer)
                if (event.data instanceof ArrayBuffer) {
                    term.write(new Uint8Array(event.data));
                } else {
                    term.write(event.data);
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

            // Terminal input → SSH (send as binary ArrayBuffer)
            const encoder = new TextEncoder();
            term.onData((data: string) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(encoder.encode(data));
                }
            });

            // Terminal resize → SSH (send as JSON text)
            term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
                }
            });

            // Window resize → fit terminal
            const handleResize = () => {
                try { fitAddon.fit(); } catch { /* ignore */ }
            };
            window.addEventListener('resize', handleResize);

            // Store refs
            termRef.current = term;
            wsRef.current = ws;
            cleanupRef.current = () => {
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
            if (termRef.current) { termRef.current.dispose(); termRef.current = null; }
            if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
            if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
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
