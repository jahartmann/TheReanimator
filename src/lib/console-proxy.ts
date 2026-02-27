/**
 * Console WebSocket Proxy — Dual Mode
 *
 * SSH mode:  Browser ↔ WebSocket ↔ ssh2 shell → PVE host (pct enter / qm terminal)
 * VNC mode:  Browser ↔ WebSocket ↔ Proxmox VNC WebSocket
 *
 * Started in instrumentation.ts on port 3001.
 * Session registration happens in console-sessions.ts (imported by Server Actions).
 */

import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import { Client as SSH2Client } from 'ssh2';
import { URL } from 'url';
import { consumeSession } from './console-sessions';
import type { SSHSession, VNCSession } from './console-sessions';

// Re-export for instrumentation.ts
export { registerConsoleSession } from './console-sessions';

// ── WebSocket Server ─────────────────────────────────────────────────

export function startConsoleProxy(port: number = 3001): void {
    const wss = new WebSocketServer({ port, path: '/console' });
    console.log(`[ConsoleProxy] WebSocket server started on port ${port}`);

    wss.on('connection', (clientWs, req) => {
        try {
            const url = new URL(req.url!, `http://localhost:${port}`);
            const sessionToken = url.searchParams.get('token');

            if (!sessionToken) {
                clientWs.close(4001, 'Missing session token');
                return;
            }

            const session = consumeSession(sessionToken);
            if (!session) {
                clientWs.close(4001, 'Invalid or expired session token');
                return;
            }

            if (session.mode === 'ssh') {
                handleSSH(clientWs, session);
            } else {
                handleVNC(clientWs, session);
            }
        } catch (err) {
            console.error('[ConsoleProxy] Connection handler error:', err);
            clientWs.close(4000, 'Internal error');
        }
    });

    wss.on('error', (err) => {
        console.error('[ConsoleProxy] Server error:', err);
    });
}

// ── SSH Mode: Direct Shell ───────────────────────────────────────────

function handleSSH(clientWs: WsWebSocket, session: SSHSession) {
    const ssh = new SSH2Client();

    ssh.on('ready', () => {
        console.log(`[ConsoleProxy/SSH] Connected to ${session.sshHost}, command: ${session.shellCommand}`);

        ssh.shell(
            { term: 'xterm-256color', cols: 80, rows: 24 },
            (err, stream) => {
                if (err) {
                    console.error('[ConsoleProxy/SSH] Shell error:', err);
                    clientWs.close(4002, 'Failed to open SSH shell');
                    ssh.end();
                    return;
                }

                // Execute the VM entry command
                if (session.shellCommand) {
                    stream.write(session.shellCommand + '\n');
                }

                // SSH output → Browser
                stream.on('data', (data: Buffer) => {
                    if (clientWs.readyState === WsWebSocket.OPEN) {
                        clientWs.send(data);
                    }
                });

                stream.stderr.on('data', (data: Buffer) => {
                    if (clientWs.readyState === WsWebSocket.OPEN) {
                        clientWs.send(data);
                    }
                });

                // Browser → SSH
                clientWs.on('message', (raw, isBinary) => {
                    if (!isBinary) {
                        try {
                            const msg = JSON.parse(raw.toString());
                            if (msg.type === 'resize' && msg.cols && msg.rows) {
                                stream.setWindow(msg.rows, msg.cols, 0, 0);
                                return;
                            }
                        } catch {
                            // Not JSON — treat as text input
                        }
                    }
                    if (stream.writable) {
                        stream.write(raw);
                    }
                });

                // Cleanup
                stream.on('close', () => {
                    console.log('[ConsoleProxy/SSH] Stream closed');
                    if (clientWs.readyState === WsWebSocket.OPEN) {
                        clientWs.close(1000, 'SSH session ended');
                    }
                    ssh.end();
                });

                clientWs.on('close', () => {
                    stream.close();
                    ssh.end();
                });

                clientWs.on('error', (err) => {
                    console.error('[ConsoleProxy/SSH] Client WS error:', err.message);
                    stream.close();
                    ssh.end();
                });

                // Keepalive ping every 30s
                const keepalive = setInterval(() => {
                    if (clientWs.readyState === WsWebSocket.OPEN) {
                        clientWs.ping();
                    } else {
                        clearInterval(keepalive);
                    }
                }, 30_000);

                clientWs.on('close', () => clearInterval(keepalive));
            }
        );
    });

    ssh.on('error', (err) => {
        console.error('[ConsoleProxy/SSH] Connection error:', err.message);
        if (clientWs.readyState === WsWebSocket.OPEN) {
            clientWs.close(4002, `SSH connection failed: ${err.message}`);
        }
    });

    const connectConfig: any = {
        host: session.sshHost,
        port: session.sshPort,
        username: session.sshUser,
        readyTimeout: 10000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 10,
    };

    if (session.sshPrivateKey) {
        connectConfig.privateKey = session.sshPrivateKey;
    } else if (session.sshPassword) {
        connectConfig.password = session.sshPassword;
    }

    ssh.connect(connectConfig);
}

// ── VNC Mode: Proxmox WebSocket Bridge ───────────────────────────────

function handleVNC(clientWs: WsWebSocket, session: VNCSession) {
    const base = new URL(session.proxmoxUrl);
    const wsProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:';

    const path = session.vmType === 'lxc'
        ? `/api2/json/nodes/${session.node}/lxc/${session.vmid}/vncwebsocket`
        : `/api2/json/nodes/${session.node}/qemu/${session.vmid}/vncwebsocket`;

    const wsUrl = `${wsProtocol}//${base.host}${path}?port=${session.port}&vncticket=${encodeURIComponent(session.vncTicket)}`;

    console.log(`[ConsoleProxy/VNC] Connecting: ${session.node}/${session.vmType}/${session.vmid}`);

    const headers: Record<string, string> = {};
    if (session.authToken) {
        headers['Authorization'] = `PVEAPIToken=${session.authToken}`;
    }
    if (session.authTicket) {
        headers['Cookie'] = `PVEAuthCookie=${encodeURIComponent(session.authTicket)}`;
    }

    const proxmoxWs = new WsWebSocket(wsUrl, {
        rejectUnauthorized: false,
        headers,
    });

    let ready = false;
    const buffer: (Buffer | string)[] = [];

    proxmoxWs.on('open', () => {
        console.log('[ConsoleProxy/VNC] Connected to Proxmox');
        ready = true;
        for (const msg of buffer) proxmoxWs.send(msg);
        buffer.length = 0;
    });

    proxmoxWs.on('message', (data) => {
        if (clientWs.readyState === WsWebSocket.OPEN) {
            clientWs.send(data);
        }
    });

    proxmoxWs.on('error', (err) => {
        console.error('[ConsoleProxy/VNC] Proxmox WS error:', err.message);
        if (clientWs.readyState === WsWebSocket.OPEN) {
            clientWs.close(4002, 'Proxmox connection error');
        }
    });

    proxmoxWs.on('close', (code) => {
        console.log(`[ConsoleProxy/VNC] Proxmox WS closed: ${code}`);
        if (clientWs.readyState === WsWebSocket.OPEN) {
            clientWs.close(1000, 'Proxmox disconnected');
        }
    });

    clientWs.on('message', (data) => {
        if (ready && proxmoxWs.readyState === WsWebSocket.OPEN) {
            proxmoxWs.send(data);
        } else {
            buffer.push(data as Buffer | string);
        }
    });

    clientWs.on('close', () => {
        if (proxmoxWs.readyState === WsWebSocket.OPEN) {
            proxmoxWs.close();
        }
    });

    clientWs.on('error', (err) => {
        console.error('[ConsoleProxy/VNC] Client WS error:', err.message);
        if (proxmoxWs.readyState === WsWebSocket.OPEN) {
            proxmoxWs.close();
        }
    });
}
