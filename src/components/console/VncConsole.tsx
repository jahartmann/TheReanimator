'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';

interface VncConsoleProps {
    serverId: number;
    vmid: number;
    vmType: 'qemu' | 'lxc';
    nodeName: string;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onCtrlAltDelRef?: React.MutableRefObject<(() => void) | null>;
}

/** Cached RFB class so we only load once */
let rfbClassCache: any = null;

/**
 * Load RFB class from @novnc/novnc with multiple fallback strategies.
 * noVNC uses CJS which can break in ESM/Next.js bundlers.
 */
async function loadRFB(): Promise<any> {
    if (rfbClassCache) return rfbClassCache;

    // Strategy 1: Dynamic import (works with transpilePackages + javascript/auto webpack rule)
    try {
        const mod = await import(/* webpackChunkName: "novnc" */ '@novnc/novnc/lib/rfb.js');
        rfbClassCache = mod.default || mod;
        if (typeof rfbClassCache === 'function') return rfbClassCache;
    } catch (e) {
        console.warn('[VNC] Dynamic import failed, trying CJS shim:', e);
    }

    // Strategy 2: Shim CJS globals and retry
    if (typeof window !== 'undefined') {
        const w = window as any;
        const origExports = w.exports;
        const origModule = w.module;
        try {
            w.exports = {};
            w.module = { exports: w.exports };
            const mod = await import('@novnc/novnc/lib/rfb.js');
            rfbClassCache = mod.default || mod || w.module.exports;
            if (typeof rfbClassCache === 'function') return rfbClassCache;
        } catch (e) {
            console.warn('[VNC] CJS shim import failed:', e);
        } finally {
            // Restore originals to avoid polluting global scope
            if (origExports === undefined) delete w.exports;
            else w.exports = origExports;
            if (origModule === undefined) delete w.module;
            else w.module = origModule;
        }
    }

    throw new Error('Failed to load VNC library (noVNC). Check browser console for details.');
}

const MAX_RETRIES = 3;
const BACKOFF_DELAYS = [1000, 2000, 4000];

export function VncConsole({ serverId, vmid, vmType, nodeName, onConnect, onDisconnect, onCtrlAltDelRef }: VncConsoleProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const rfbRef = useRef<any>(null);
    const retryCountRef = useRef(0);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
    const [error, setError] = useState<string | null>(null);
    const [retryInfo, setRetryInfo] = useState<string | null>(null);

    const connect = useCallback(async () => {
        if (!containerRef.current) return;
        setStatus('connecting');
        setError(null);
        setRetryInfo(retryCountRef.current > 0 ? `Retry ${retryCountRef.current}/${MAX_RETRIES}...` : null);

        try {
            // Build WebSocket URL — same host/port, /ws/vnc/ path
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${wsProtocol}//${location.host}/ws/vnc/${serverId}-${vmid}?type=${vmType}&node=${nodeName}`;

            // Load noVNC RFB class
            const RFB = await loadRFB();

            // Clean up previous connection
            if (rfbRef.current) {
                try { rfbRef.current.disconnect(); } catch { /* ignore */ }
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
                retryCountRef.current = 0;
                setRetryInfo(null);
                setStatus('connected');
                onConnect?.();
            });

            rfb.addEventListener('disconnect', (e: any) => {
                setStatus('disconnected');
                onDisconnect?.();
                if (e.detail?.clean === false) {
                    // Auto-retry on unexpected disconnect
                    if (retryCountRef.current < MAX_RETRIES) {
                        const delay = BACKOFF_DELAYS[retryCountRef.current] || 4000;
                        retryCountRef.current++;
                        setRetryInfo(`Connection lost. Retrying in ${delay / 1000}s... (${retryCountRef.current}/${MAX_RETRIES})`);
                        retryTimerRef.current = setTimeout(() => connect(), delay);
                    } else {
                        setError('Connection lost after multiple retries');
                        setRetryInfo(null);
                    }
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
            console.error('[VNC] Connection error:', err);
            // Auto-retry on connection error
            if (retryCountRef.current < MAX_RETRIES) {
                const delay = BACKOFF_DELAYS[retryCountRef.current] || 4000;
                retryCountRef.current++;
                setRetryInfo(`Failed to connect. Retrying in ${delay / 1000}s... (${retryCountRef.current}/${MAX_RETRIES})`);
                setStatus('connecting');
                retryTimerRef.current = setTimeout(() => connect(), delay);
            } else {
                setStatus('error');
                setError(err instanceof Error ? err.message : 'Failed to connect');
                setRetryInfo(null);
                onDisconnect?.();
            }
        }
    }, [serverId, vmid, vmType, nodeName, onConnect, onDisconnect, onCtrlAltDelRef]);

    useEffect(() => {
        connect();
        return () => {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            if (rfbRef.current) {
                try { rfbRef.current.disconnect(); } catch { /* ignore */ }
                rfbRef.current = null;
            }
        };
    }, [connect]);

    const reconnect = useCallback(() => {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryCountRef.current = 0;
        if (rfbRef.current) {
            try { rfbRef.current.disconnect(); } catch { /* ignore */ }
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
                        <span className="text-sm text-muted-foreground">
                            {retryInfo || 'Connecting to VNC...'}
                        </span>
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
