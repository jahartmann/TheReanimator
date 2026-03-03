/**
 * SSH Connection Pool — Singleton
 * Reuses idle SSH connections to avoid repeated connect/disconnect overhead.
 */

import { SSHClient, createSSHClient } from './ssh';

interface PooledConnection {
    client: SSHClient;
    key: string;
    inUse: boolean;
    lastUsed: number;
}

const MAX_PER_HOST = 3;
const MAX_TOTAL = 20;
const IDLE_TIMEOUT_MS = 60_000;
const CLEANUP_INTERVAL_MS = 30_000;

class SSHConnectionPool {
    private pool: PooledConnection[] = [];
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;

    constructor() {
        // Cleanup timer starts lazily on first acquire() — not at import time
    }

    private startCleanup() {
        if (this.cleanupTimer) return;
        this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
        // Don't block process exit
        if (this.cleanupTimer.unref) this.cleanupTimer.unref();
    }

    /** Acquire an SSH connection (reuses idle or creates new) */
    async acquire(server: {
        ssh_host?: string;
        ssh_port?: number;
        ssh_user?: string;
        ssh_key?: string;
        url?: string;
    }): Promise<SSHClient> {
        this.startCleanup(); // Start timer on first actual use, not at import time
        // Build a temporary client just to get the pool key
        const tempClient = createSSHClient(server);
        const key = tempClient.getPoolKey();

        // Try to find an idle, alive connection with the same key
        const idle = this.pool.find(c => c.key === key && !c.inUse && c.client.isAlive());
        if (idle) {
            idle.inUse = true;
            idle.lastUsed = Date.now();
            console.log(`[SSHPool] Reusing connection for ${key} (pool: ${this.pool.length})`);
            return idle.client;
        }

        // Check limits
        const hostCount = this.pool.filter(c => c.key === key).length;
        if (hostCount >= MAX_PER_HOST) {
            // Evict oldest idle connection for this host
            const oldestIdle = this.pool
                .filter(c => c.key === key && !c.inUse)
                .sort((a, b) => a.lastUsed - b.lastUsed)[0];
            if (oldestIdle) {
                this.destroyConnection(oldestIdle);
            } else {
                throw new Error(`[SSHPool] Max connections (${MAX_PER_HOST}) reached for ${key}`);
            }
        }

        if (this.pool.length >= MAX_TOTAL) {
            // Evict oldest idle connection globally
            const oldestIdle = this.pool
                .filter(c => !c.inUse)
                .sort((a, b) => a.lastUsed - b.lastUsed)[0];
            if (oldestIdle) {
                this.destroyConnection(oldestIdle);
            } else {
                throw new Error(`[SSHPool] Max total connections (${MAX_TOTAL}) reached`);
            }
        }

        // Create new connection
        const client = createSSHClient(server);
        await client.connect();

        const entry: PooledConnection = {
            client,
            key,
            inUse: true,
            lastUsed: Date.now(),
        };

        // Auto-remove on unexpected close
        client.onClose(() => {
            const idx = this.pool.indexOf(entry);
            if (idx !== -1) {
                this.pool.splice(idx, 1);
                console.log(`[SSHPool] Connection ${key} died, removed from pool`);
            }
        });

        this.pool.push(entry);
        console.log(`[SSHPool] New connection for ${key} (pool: ${this.pool.length})`);
        return client;
    }

    /** Release a connection back to the pool */
    release(client: SSHClient): void {
        const entry = this.pool.find(c => c.client === client);
        if (!entry) {
            // Not pooled — just disconnect
            try { client.disconnect(); } catch {}
            return;
        }

        if (!client.isAlive()) {
            this.destroyConnection(entry);
            return;
        }

        entry.inUse = false;
        entry.lastUsed = Date.now();
    }

    /** Convenience: acquire, run function, auto-release */
    async withSSH<T>(
        server: {
            ssh_host?: string;
            ssh_port?: number;
            ssh_user?: string;
            ssh_key?: string;
            url?: string;
        },
        fn: (ssh: SSHClient) => Promise<T>
    ): Promise<T> {
        const ssh = await this.acquire(server);
        try {
            return await fn(ssh);
        } finally {
            this.release(ssh);
        }
    }

    /** Destroy idle connections older than IDLE_TIMEOUT_MS */
    cleanup(): void {
        const now = Date.now();
        const toRemove = this.pool.filter(
            c => !c.inUse && (now - c.lastUsed > IDLE_TIMEOUT_MS || !c.client.isAlive())
        );

        for (const entry of toRemove) {
            this.destroyConnection(entry);
        }

        if (toRemove.length > 0) {
            console.log(`[SSHPool] Cleanup: removed ${toRemove.length} idle connections (pool: ${this.pool.length})`);
        }
    }

    /** Destroy all connections (graceful shutdown) */
    destroyAll(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }

        for (const entry of [...this.pool]) {
            this.destroyConnection(entry);
        }

        console.log('[SSHPool] All connections destroyed');
    }

    /** Get pool statistics for debugging */
    getStats() {
        const byHost: Record<string, { total: number; inUse: number; idle: number }> = {};

        for (const entry of this.pool) {
            if (!byHost[entry.key]) {
                byHost[entry.key] = { total: 0, inUse: 0, idle: 0 };
            }
            byHost[entry.key].total++;
            if (entry.inUse) byHost[entry.key].inUse++;
            else byHost[entry.key].idle++;
        }

        return {
            totalConnections: this.pool.length,
            inUse: this.pool.filter(c => c.inUse).length,
            idle: this.pool.filter(c => !c.inUse).length,
            byHost,
        };
    }

    private destroyConnection(entry: PooledConnection) {
        const idx = this.pool.indexOf(entry);
        if (idx !== -1) this.pool.splice(idx, 1);
        try { entry.client.disconnect(); } catch {}
    }
}

// Singleton — survives HMR in dev
const globalForPool = global as unknown as { sshPool: SSHConnectionPool | undefined };
export const sshPool = globalForPool.sshPool ?? new SSHConnectionPool();
globalForPool.sshPool = sshPool;

/** Convenience export: acquire + run + auto-release */
export const withSSH = sshPool.withSSH.bind(sshPool);
