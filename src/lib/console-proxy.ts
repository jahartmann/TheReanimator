/**
 * Console WebSocket Proxy
 * Bridges browser WebSocket connections to Proxmox VNC/Terminal WebSocket endpoints
 * Started in instrumentation.ts alongside scheduler and telegram bot
 */

import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import https from 'https';
import http from 'http';
import { URL } from 'url';

export interface ConsoleSession {
    proxmoxUrl: string;       // e.g. https://192.168.1.100:8006
    node: string;
    vmid: number;
    vmType: 'qemu' | 'lxc';
    consoleType: 'vnc' | 'terminal';
    ticket: string;           // PVE auth ticket
    vncTicket: string;        // VNC/term-specific ticket
    port: number;             // VNC/term port from proxy response
    token?: string;           // PVE API token (alternative auth)
    createdAt: number;
}

// In-memory session store with TTL
const sessions = new Map<string, ConsoleSession>();
const SESSION_TTL = 60_000; // 60 seconds

// Cleanup expired sessions every 30s
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of sessions) {
        if (now - session.createdAt > SESSION_TTL) {
            sessions.delete(key);
        }
    }
}, 30_000);

// Register a new console session, returns one-time token
export function registerConsoleSession(session: Omit<ConsoleSession, 'createdAt'>): string {
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
    sessions.set(token, { ...session, createdAt: Date.now() });
    return token;
}

export function startConsoleProxy(port: number = 3001): void {
    const wss = new WebSocketServer({ port, path: '/console' });
    console.log(`[ConsoleProxy] WebSocket server started on port ${port}`);

    wss.on('connection', async (clientWs, req) => {
        try {
            const url = new URL(req.url!, `http://localhost:${port}`);
            const sessionToken = url.searchParams.get('token');

            if (!sessionToken) {
                clientWs.close(4001, 'Missing session token');
                return;
            }

            // Validate and consume session (one-time use)
            const session = sessions.get(sessionToken);
            if (!session) {
                clientWs.close(4001, 'Invalid or expired session token');
                return;
            }
            sessions.delete(sessionToken);

            // Build Proxmox WebSocket URL
            const proxmoxWsUrl = buildProxmoxWsUrl(session);
            console.log(`[ConsoleProxy] Connecting to Proxmox: ${session.node}/${session.vmType}/${session.vmid} (${session.consoleType})`);

            // Connect to Proxmox WebSocket
            // Use API token if available, otherwise fall back to auth cookie
            const wsHeaders: Record<string, string> = {};
            if (session.token) {
                wsHeaders['Authorization'] = `PVEAPIToken=${session.token}`;
            }
            if (session.ticket) {
                wsHeaders['Cookie'] = `PVEAuthCookie=${encodeURIComponent(session.ticket)}`;
            }

            const proxmoxWs = new WsWebSocket(proxmoxWsUrl, {
                rejectUnauthorized: false, // Self-signed certs
                headers: wsHeaders
            });

            let proxmoxReady = false;
            const bufferedMessages: (Buffer | string)[] = [];

            proxmoxWs.on('open', () => {
                console.log(`[ConsoleProxy] Connected to Proxmox WS`);
                proxmoxReady = true;
                // Flush buffered messages
                for (const msg of bufferedMessages) {
                    proxmoxWs.send(msg);
                }
                bufferedMessages.length = 0;
            });

            proxmoxWs.on('message', (data) => {
                if (clientWs.readyState === WsWebSocket.OPEN) {
                    clientWs.send(data);
                }
            });

            proxmoxWs.on('error', (err) => {
                console.error(`[ConsoleProxy] Proxmox WS error:`, err.message);
                clientWs.close(4002, 'Proxmox connection error');
            });

            proxmoxWs.on('close', (code, reason) => {
                console.log(`[ConsoleProxy] Proxmox WS closed: ${code}`);
                if (clientWs.readyState === WsWebSocket.OPEN) {
                    clientWs.close(1000, 'Proxmox disconnected');
                }
            });

            // Client → Proxmox
            clientWs.on('message', (data) => {
                if (proxmoxReady && proxmoxWs.readyState === WsWebSocket.OPEN) {
                    proxmoxWs.send(data);
                } else {
                    // Buffer messages until Proxmox connection is ready
                    bufferedMessages.push(data as Buffer | string);
                }
            });

            clientWs.on('close', () => {
                console.log(`[ConsoleProxy] Client disconnected`);
                if (proxmoxWs.readyState === WsWebSocket.OPEN) {
                    proxmoxWs.close();
                }
            });

            clientWs.on('error', (err) => {
                console.error(`[ConsoleProxy] Client WS error:`, err.message);
                proxmoxWs.close();
            });

        } catch (err) {
            console.error(`[ConsoleProxy] Connection handler error:`, err);
            clientWs.close(4000, 'Internal error');
        }
    });

    wss.on('error', (err) => {
        console.error(`[ConsoleProxy] Server error:`, err);
    });
}

function buildProxmoxWsUrl(session: ConsoleSession): string {
    // Parse base URL
    const base = new URL(session.proxmoxUrl);
    const wsProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:';

    if (session.consoleType === 'vnc') {
        // VNC WebSocket endpoint
        const path = session.vmType === 'lxc'
            ? `/api2/json/nodes/${session.node}/lxc/${session.vmid}/vncwebsocket`
            : `/api2/json/nodes/${session.node}/qemu/${session.vmid}/vncwebsocket`;
        return `${wsProtocol}//${base.host}${path}?port=${session.port}&vncticket=${encodeURIComponent(session.vncTicket)}`;
    } else {
        // Terminal WebSocket endpoint
        const path = session.vmType === 'lxc'
            ? `/api2/json/nodes/${session.node}/lxc/${session.vmid}/vncwebsocket`
            : `/api2/json/nodes/${session.node}/qemu/${session.vmid}/vncwebsocket`;
        return `${wsProtocol}//${base.host}${path}?port=${session.port}&vncticket=${encodeURIComponent(session.vncTicket)}`;
    }
}
