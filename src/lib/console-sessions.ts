/**
 * Console session store — shared between Server Actions and WebSocket proxy.
 *
 * Uses globalThis so that both module instances (if created by Next.js bundler)
 * share the same Map within the Node.js process.
 *
 * This file intentionally has NO heavy imports (no ws, ssh2, etc.)
 * so it can be safely imported from Server Actions without side effects.
 */

// ── Session Types ────────────────────────────────────────────────────

export interface SSHSession {
    mode: 'ssh';
    sshHost: string;
    sshPort: number;
    sshUser: string;
    sshPassword?: string;
    sshPrivateKey?: string;
    shellCommand: string;
    createdAt: number;
}

export interface VNCSession {
    mode: 'vnc';
    proxmoxUrl: string;
    node: string;
    vmid: number;
    vmType: 'qemu' | 'lxc';
    vncTicket: string;
    port: number;
    authToken?: string;
    authTicket?: string;
    createdAt: number;
}

export type ConsoleSession = SSHSession | VNCSession;

// ── Session Store (globalThis-backed) ────────────────────────────────

const SESSION_TTL = 60_000;
const GLOBAL_KEY = '__reanimator_console_sessions';
const CLEANUP_KEY = '__reanimator_console_cleanup';

export function getSessionMap(): Map<string, ConsoleSession> {
    const g = globalThis as any;
    if (!g[GLOBAL_KEY]) {
        g[GLOBAL_KEY] = new Map<string, ConsoleSession>();
    }
    // Start cleanup interval once
    if (!g[CLEANUP_KEY]) {
        g[CLEANUP_KEY] = true;
        setInterval(() => {
            const now = Date.now();
            const map = g[GLOBAL_KEY] as Map<string, ConsoleSession>;
            for (const [key, session] of map) {
                if (now - session.createdAt > SESSION_TTL) map.delete(key);
            }
        }, 30_000);
    }
    return g[GLOBAL_KEY];
}

/**
 * Register a console session and return a one-time token.
 * Called from Server Actions (console.ts).
 */
export function registerConsoleSession(
    session: Omit<SSHSession, 'createdAt'> | Omit<VNCSession, 'createdAt'>
): string {
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
    const map = getSessionMap();
    map.set(token, { ...session, createdAt: Date.now() } as ConsoleSession);
    console.log(`[ConsoleSession] Registered: ${token.slice(0, 8)}... (${session.mode} mode, total: ${map.size})`);
    return token;
}

/**
 * Consume a session token (one-time use).
 * Called from WebSocket proxy (console-proxy.ts).
 */
export function consumeSession(token: string): ConsoleSession | undefined {
    const map = getSessionMap();
    const session = map.get(token);
    if (session) {
        map.delete(token);
        console.log(`[ConsoleSession] Consumed: ${token.slice(0, 8)}... (remaining: ${map.size})`);
    } else {
        console.log(`[ConsoleSession] Not found: ${token.slice(0, 8)}... (map size: ${map.size})`);
    }
    return session;
}
