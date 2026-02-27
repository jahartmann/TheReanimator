'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getConsoleAccess } from '@/lib/actions/console';
import { Loader2 } from 'lucide-react';

interface VncConsoleProps {
    serverId: number;
    vmid: number;
    vmType: 'qemu' | 'lxc';
    onConnect?: () => void;
    onDisconnect?: () => void;
    onCtrlAltDelRef?: React.MutableRefObject<(() => void) | null>;
}

export function VncConsole({ serverId, vmid, vmType, onConnect, onDisconnect, onCtrlAltDelRef }: VncConsoleProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const rfbRef = useRef<any>(null);
    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
    const [error, setError] = useState<string | null>(null);

    const connect = useCallback(async () => {
        if (!containerRef.current) return;
        setStatus('connecting');
        setError(null);

        try {
            // Get console access token
            const { sessionToken, wsPort } = await getConsoleAccess(serverId, vmid, vmType, 'vnc');

            // Build WebSocket URL
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsHost = window.location.hostname;
            const wsUrl = `${wsProtocol}//${wsHost}:${wsPort}/console?token=${sessionToken}`;

            // Dynamically import noVNC
            const { default: RFB } = await import('@novnc/novnc/lib/rfb.js');

            // Clean up previous connection
            if (rfbRef.current) {
                rfbRef.current.disconnect();
                rfbRef.current = null;
            }

            // Clear container
            containerRef.current.innerHTML = '';

            // Create noVNC connection
            const rfb = new RFB(containerRef.current, wsUrl, {
                wsProtocols: ['binary'],
            });

            rfb.scaleViewport = true;
            rfb.resizeSession = true;
            rfb.clipViewport = false;

            rfb.addEventListener('connect', () => {
                setStatus('connected');
                onConnect?.();
            });

            rfb.addEventListener('disconnect', (e: any) => {
                setStatus('disconnected');
                onDisconnect?.();
                if (e.detail?.clean === false) {
                    setError('Connection lost unexpectedly');
                }
            });

            rfb.addEventListener('securityfailure', (e: any) => {
                setStatus('error');
                setError(`Security error: ${e.detail?.reason || 'Unknown'}`);
            });

            rfbRef.current = rfb;

            // Expose Ctrl+Alt+Del
            if (onCtrlAltDelRef) {
                onCtrlAltDelRef.current = () => rfb.sendCtrlAltDel();
            }

        } catch (err) {
            setStatus('error');
            setError(err instanceof Error ? err.message : 'Failed to connect');
            onDisconnect?.();
        }
    }, [serverId, vmid, vmType, onConnect, onDisconnect, onCtrlAltDelRef]);

    useEffect(() => {
        connect();
        return () => {
            if (rfbRef.current) {
                rfbRef.current.disconnect();
                rfbRef.current = null;
            }
        };
    }, [connect]);

    // Expose reconnect
    const reconnect = useCallback(() => {
        if (rfbRef.current) {
            rfbRef.current.disconnect();
            rfbRef.current = null;
        }
        connect();
    }, [connect]);

    return (
        <div className="relative h-full w-full bg-black">
            {status === 'connecting' && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                    <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <span className="text-sm text-muted-foreground">Connecting to VNC...</span>
                    </div>
                </div>
            )}
            {status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                    <div className="flex flex-col items-center gap-2 text-center p-4">
                        <span className="text-sm text-destructive">{error}</span>
                        <button onClick={reconnect} className="text-sm text-primary hover:underline">
                            Retry connection
                        </button>
                    </div>
                </div>
            )}
            <div ref={containerRef} className="h-full w-full" />
        </div>
    );
}

VncConsole.displayName = 'VncConsole';
