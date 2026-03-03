/**
 * Custom Server for Reanimator
 * Handles both HTTP (Next.js) and WebSocket (terminal) connections on one port.
 *
 * Production: `node server.js`
 * Dev: runs alongside `next dev` on separate WS port (3001)
 */

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

// Signal to instrumentation.ts that we are running as a live server, not a build.
// This env var is inherited by all Next.js worker processes spawned from here.
process.env.REANIMATOR_SERVER = '1';

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

/** Simple cookie parser */
function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach((pair) => {
        const idx = pair.indexOf('=');
        if (idx < 0) return;
        const key = pair.substring(0, idx).trim();
        const val = pair.substring(idx + 1).trim();
        cookies[key] = decodeURIComponent(val);
    });
    return cookies;
}

app.prepare().then(() => {
    const server = createServer(async (req, res) => {
        try {
            const parsedUrl = parse(req.url || '', true);
            await handle(req, res, parsedUrl);
        } catch (err) {
            console.error('[Server] Error handling request:', err);
            res.statusCode = 500;
            res.end('Internal Server Error');
        }
    });

    // Create WebSocket server (noServer mode — we handle upgrades manually)
    const wss = new WebSocketServer({ noServer: true });

    // VNC WebSocket server (separate instance for raw binary proxying)
    const wssVnc = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        const { pathname } = parse(req.url || '', true);

        if (pathname && pathname.startsWith('/ws/terminal/')) {
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        } else if (pathname && pathname.startsWith('/ws/vnc/')) {
            wssVnc.handleUpgrade(req, socket, head, (ws) => {
                wssVnc.emit('connection', ws, req);
            });
        }
        // Other upgrade requests (e.g. Next.js HMR in dev) are handled by Next.js internally
    });

    wss.on('connection', (ws, req) => {
        const { pathname } = parse(req.url || '', true);
        const match = pathname && pathname.match(/^\/ws\/terminal\/(.+)$/);
        if (!match) {
            ws.close(4000, 'Invalid path');
            return;
        }
        handleTerminalConnection(ws, req, match[1]);
    });

    wssVnc.on('connection', (ws, req) => {
        const { pathname, query } = parse(req.url || '', true);
        const match = pathname && pathname.match(/^\/ws\/vnc\/(\d+)-(\d+)$/);
        if (!match) {
            ws.close(4000, 'Invalid path');
            return;
        }
        handleVncConnection(ws, req, parseInt(match[1]), parseInt(match[2]), query);
    });

    server.listen(port, hostname, () => {
        console.log(`[Server] Reanimator running on http://${hostname}:${port}`);
    });

    // Graceful shutdown
    const shutdown = () => {
        console.log('[Server] Shutting down...');
        wss.clients.forEach((ws) => ws.close(1001, 'Server shutting down'));
        wssVnc.clients.forEach((ws) => ws.close(1001, 'Server shutting down'));
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(1), 10000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
});

/**
 * Handle a terminal WebSocket connection.
 * Validates session, establishes SSH, and bridges I/O.
 */
function handleTerminalConnection(ws, req, sessionId) {
    const { Client } = require('ssh2');
    const Database = require('better-sqlite3');
    const path = require('path');

    // --- Auth ---
    const cookies = parseCookies(req.headers.cookie);
    if (!cookies.session || !cookies.session_expires) {
        ws.close(4001, 'Unauthorized');
        return;
    }

    try {
        if (new Date(cookies.session_expires) < new Date()) {
            ws.close(4001, 'Session expired');
            return;
        }
    } catch {
        ws.close(4001, 'Invalid session');
        return;
    }

    const dbPath = path.join(process.cwd(), 'data', 'proxhost.db');
    let db;
    try {
        db = new Database(dbPath, { readonly: true });
        const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(cookies.session);
        if (!session) {
            db.close();
            ws.close(4001, 'Invalid session token');
            return;
        }
    } catch (e) {
        console.error('[Terminal] DB auth check failed:', e);
        if (db) try { db.close(); } catch {}
        ws.close(4002, 'Auth failed');
        return;
    }

    // --- Session lookup ---
    // sessionId format: "{serverId}-{vmid}"
    const dashIdx = sessionId.indexOf('-');
    if (dashIdx < 1) {
        db.close();
        ws.close(4003, 'Invalid session ID');
        return;
    }

    const serverId = parseInt(sessionId.substring(0, dashIdx));
    const vmid = sessionId.substring(dashIdx + 1);

    let serverInfo;
    try {
        serverInfo = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
        db.close();
    } catch (e) {
        if (db) try { db.close(); } catch {}
        ws.close(4004, 'Server lookup failed');
        return;
    }

    if (!serverInfo) {
        ws.close(4004, 'Server not found');
        return;
    }

    // --- SSH Connection ---
    const sshClient = new Client();
    let shellStream = null;

    const sshKey = serverInfo.ssh_key;
    const isPrivateKey = sshKey && sshKey.trim().startsWith('-----BEGIN');

    let sshHost = serverInfo.ssh_host;
    if (!sshHost && serverInfo.url) {
        try { sshHost = new URL(serverInfo.url).hostname; } catch {}
    }

    if (!sshHost) {
        ws.close(4006, 'No SSH host');
        return;
    }

    const connectConfig = {
        host: sshHost,
        port: serverInfo.ssh_port || 22,
        username: serverInfo.ssh_user || 'root',
        readyTimeout: 15000,
        keepaliveInterval: 20000,
        keepaliveCountMax: 10,
    };

    if (isPrivateKey) {
        connectConfig.privateKey = sshKey;
    } else if (sshKey) {
        connectConfig.password = sshKey;
    }

    const send = (obj) => {
        if (ws.readyState === 1) ws.send(JSON.stringify(obj));
    };

    sshClient.on('ready', () => {
        console.log(`[Terminal] SSH connected: server=${serverId} vm=${vmid}`);

        sshClient.shell(
            { term: 'xterm-256color', cols: 80, rows: 24 },
            (err, stream) => {
                if (err) {
                    console.error('[Terminal] Shell error:', err);
                    send({ type: 'status', status: 'disconnected' });
                    ws.close(4007, 'Shell failed');
                    return;
                }

                shellStream = stream;
                send({ type: 'status', status: 'connected' });

                stream.on('data', (data) => {
                    send({ type: 'output', data: data.toString('utf-8') });
                });

                stream.stderr.on('data', (data) => {
                    send({ type: 'output', data: data.toString('utf-8') });
                });

                stream.on('close', () => {
                    console.log(`[Terminal] Shell closed: server=${serverId} vm=${vmid}`);
                    send({ type: 'status', status: 'disconnected' });
                    ws.close(1000, 'Shell closed');
                });

                // Auto-enter VM if not host console
                if (vmid && vmid !== '0' && vmid !== 'host') {
                    setTimeout(() => {
                        // Try pct enter (LXC), falls back to host shell for QEMU
                        stream.write(`pct enter ${vmid} 2>/dev/null || echo "[Use 'qm terminal ${vmid}' for QEMU VMs]"\n`);
                    }, 500);
                }
            }
        );
    });

    sshClient.on('error', (err) => {
        console.error(`[Terminal] SSH error: server=${serverId}`, err.message);
        send({ type: 'status', status: 'disconnected' });
        ws.close(4008, 'SSH error');
    });

    sshClient.on('close', () => {
        send({ type: 'status', status: 'disconnected' });
    });

    // --- WebSocket I/O ---
    ws.on('message', (rawMsg) => {
        try {
            const msg = JSON.parse(rawMsg.toString());
            if (msg.type === 'input' && shellStream) {
                shellStream.write(msg.data);
            } else if (msg.type === 'resize' && shellStream) {
                shellStream.setWindow(msg.rows, msg.cols, 0, 0);
            }
        } catch {}
    });

    const cleanup = () => {
        if (shellStream) try { shellStream.close(); } catch {}
        try { sshClient.end(); } catch {}
    };

    ws.on('close', () => {
        console.log(`[Terminal] WS closed: server=${serverId} vm=${vmid}`);
        cleanup();
    });

    ws.on('error', () => cleanup());

    // Idle timeout: 10 minutes
    let idleTimer = setTimeout(() => {
        console.log(`[Terminal] Idle timeout: server=${serverId} vm=${vmid}`);
        ws.close(4009, 'Idle timeout');
    }, 10 * 60 * 1000);

    ws.on('message', () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            ws.close(4009, 'Idle timeout');
        }, 10 * 60 * 1000);
    });

    // Connect
    sshClient.connect(connectConfig);
}

/**
 * Handle a VNC WebSocket connection.
 * Authenticates, gets VNC ticket from Proxmox, and bridges to Proxmox VNC WebSocket.
 */
function handleVncConnection(ws, req, serverId, vmid, query) {
    const Database = require('better-sqlite3');
    const path = require('path');
    const https = require('https');
    const { WebSocket: WsClient } = require('ws');

    const vmType = query.type || 'qemu'; // 'qemu' or 'lxc'
    const nodeName = query.node;

    if (!nodeName) {
        ws.close(4003, 'Missing node parameter');
        return;
    }

    // --- Auth (same as terminal) ---
    const cookies = parseCookies(req.headers.cookie);
    if (!cookies.session || !cookies.session_expires) {
        ws.close(4001, 'Unauthorized');
        return;
    }

    try {
        if (new Date(cookies.session_expires) < new Date()) {
            ws.close(4001, 'Session expired');
            return;
        }
    } catch {
        ws.close(4001, 'Invalid session');
        return;
    }

    const dbPath = path.join(process.cwd(), 'data', 'proxhost.db');
    let db;
    try {
        db = new Database(dbPath, { readonly: true });
        const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(cookies.session);
        if (!session) {
            db.close();
            ws.close(4001, 'Invalid session token');
            return;
        }
    } catch (e) {
        console.error('[VNC] DB auth check failed:', e);
        if (db) try { db.close(); } catch {}
        ws.close(4002, 'Auth failed');
        return;
    }

    // --- Server lookup ---
    let serverInfo;
    try {
        serverInfo = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
        db.close();
    } catch (e) {
        if (db) try { db.close(); } catch {}
        ws.close(4004, 'Server lookup failed');
        return;
    }

    if (!serverInfo) {
        ws.close(4004, 'Server not found');
        return;
    }

    if (!serverInfo.url) {
        ws.close(4005, 'No Proxmox URL configured');
        return;
    }

    // --- Get Proxmox auth headers ---
    getProxmoxAuth(serverInfo)
        .then(({ headers: authHeaders, ticket }) => {
            // --- Request VNC proxy ticket from Proxmox ---
            const baseUrl = new URL(serverInfo.url);
            const vncProxyPath = `/api2/json/nodes/${nodeName}/${vmType}/${vmid}/vncproxy`;

            const postData = 'websocket=1';
            const reqOptions = {
                hostname: baseUrl.hostname,
                port: baseUrl.port || 8006,
                path: vncProxyPath,
                method: 'POST',
                rejectAuthorized: false,
                headers: {
                    ...authHeaders,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData),
                },
            };

            // Use https agent that ignores self-signed certs
            const agent = new https.Agent({ rejectUnauthorized: false });

            const proxyReq = https.request({ ...reqOptions, agent }, (proxyRes) => {
                let body = '';
                proxyRes.on('data', (chunk) => { body += chunk; });
                proxyRes.on('end', () => {
                    if (proxyRes.statusCode !== 200) {
                        console.error(`[VNC] VNC proxy request failed (${proxyRes.statusCode}): ${body.slice(0, 200)}`);
                        ws.close(4005, 'VNC proxy request failed');
                        return;
                    }

                    let vncData;
                    try {
                        vncData = JSON.parse(body).data;
                    } catch (e) {
                        console.error('[VNC] Failed to parse VNC proxy response:', body.slice(0, 200));
                        ws.close(4005, 'Invalid VNC proxy response');
                        return;
                    }

                    const vncTicket = vncData.ticket;
                    const vncPort = vncData.port;

                    console.log(`[VNC] Proxy obtained: server=${serverId} ${vmType}/${vmid} port=${vncPort}`);

                    // --- Connect to Proxmox VNC WebSocket ---
                    const wsProtocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';
                    const vncWsPath = `/api2/json/nodes/${nodeName}/${vmType}/${vmid}/vncwebsocket?port=${vncPort}&vncticket=${encodeURIComponent(vncTicket)}`;
                    const vncWsUrl = `${wsProtocol}//${baseUrl.host}${vncWsPath}`;

                    const vncWsHeaders = {};
                    if (serverInfo.auth_token) {
                        vncWsHeaders['Authorization'] = `PVEAPIToken=${serverInfo.auth_token}`;
                    }
                    if (ticket) {
                        vncWsHeaders['Cookie'] = `PVEAuthCookie=${encodeURIComponent(ticket)}`;
                    }

                    const proxmoxWs = new WsClient(vncWsUrl, {
                        rejectUnauthorized: false,
                        headers: vncWsHeaders,
                    });

                    let ready = false;
                    const buffer = [];

                    proxmoxWs.on('open', () => {
                        console.log(`[VNC] Connected to Proxmox: server=${serverId} ${vmType}/${vmid}`);
                        ready = true;
                        for (const msg of buffer) proxmoxWs.send(msg);
                        buffer.length = 0;
                    });

                    // Proxmox → Client
                    proxmoxWs.on('message', (data) => {
                        if (ws.readyState === 1) {
                            ws.send(data);
                        }
                    });

                    proxmoxWs.on('error', (err) => {
                        console.error(`[VNC] Proxmox WS error: server=${serverId}`, err.message);
                        if (ws.readyState === 1) {
                            ws.close(4006, 'Proxmox connection error');
                        }
                    });

                    proxmoxWs.on('close', (code) => {
                        console.log(`[VNC] Proxmox WS closed: server=${serverId} code=${code}`);
                        if (ws.readyState === 1) {
                            ws.close(1000, 'Proxmox disconnected');
                        }
                    });

                    // Client → Proxmox
                    ws.on('message', (data) => {
                        if (ready && proxmoxWs.readyState === 1) {
                            proxmoxWs.send(data);
                        } else if (!ready) {
                            buffer.push(data);
                        }
                    });

                    ws.on('close', () => {
                        console.log(`[VNC] Client WS closed: server=${serverId} ${vmType}/${vmid}`);
                        if (proxmoxWs.readyState === 1) {
                            proxmoxWs.close();
                        }
                    });

                    ws.on('error', (err) => {
                        console.error(`[VNC] Client WS error: server=${serverId}`, err.message);
                        if (proxmoxWs.readyState === 1) {
                            proxmoxWs.close();
                        }
                    });
                });
            });

            proxyReq.on('error', (err) => {
                console.error(`[VNC] VNC proxy HTTP request error: server=${serverId}`, err.message);
                ws.close(4005, 'VNC proxy request failed');
            });

            proxyReq.write(postData);
            proxyReq.end();
        })
        .catch((err) => {
            console.error(`[VNC] Auth failed for server ${serverId}:`, err.message);
            ws.close(4002, 'Proxmox auth failed');
        });
}

/**
 * Get Proxmox API auth headers for a server.
 * Tries: 1) stored API token, 2) password-based ticket auth.
 * Returns headers object and optional ticket string.
 */
async function getProxmoxAuth(serverInfo) {
    const https = require('https');

    // Method 1: API token (already stored)
    if (serverInfo.auth_token) {
        return {
            headers: { 'Authorization': `PVEAPIToken=${serverInfo.auth_token}` },
            ticket: null,
        };
    }

    // Method 2: Password auth (SSH password = Proxmox password)
    const sshKey = serverInfo.ssh_key;
    const isPrivateKey = sshKey && sshKey.trim().startsWith('-----BEGIN');

    if (!isPrivateKey && sshKey) {
        const username = `${serverInfo.ssh_user || 'root'}@pam`;
        const baseUrl = new URL(serverInfo.url);

        return new Promise((resolve, reject) => {
            const postData = new URLSearchParams({
                username,
                password: sshKey,
            }).toString();

            const agent = new https.Agent({ rejectUnauthorized: false });
            const req = https.request({
                hostname: baseUrl.hostname,
                port: baseUrl.port || 8006,
                path: '/api2/json/access/ticket',
                method: 'POST',
                agent,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData),
                },
            }, (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`Proxmox auth failed (${res.statusCode}): ${body.slice(0, 200)}`));
                        return;
                    }
                    try {
                        const data = JSON.parse(body).data;
                        const ticket = data.ticket;
                        const csrfToken = data.CSRFPreventionToken;
                        const headers = {
                            'Cookie': `PVEAuthCookie=${encodeURIComponent(ticket)}`,
                        };
                        if (csrfToken) headers['CSRFPreventionToken'] = csrfToken;
                        resolve({ headers, ticket });
                    } catch (e) {
                        reject(new Error('Failed to parse auth response'));
                    }
                });
            });

            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    }

    throw new Error('No auth method available (no API token or password)');
}
