'use server';

import db from '@/lib/db';
import { getCurrentUser } from './userAuth';

export interface Server {
    id: number;
    name: string;
    host: string;
    type: 'pve' | 'pbs';
    url: string;
    ssh_host: string;
    ssh_port: number;
    ssh_user: string;
    ssh_key?: string;
    group_name?: string;
    auth_token?: string; // API Token for migrations
    ssl_fingerprint?: string; // SSL Fingerprint for migrations
}

export async function getServers(): Promise<Server[]> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const rows = db.prepare('SELECT * FROM servers ORDER BY name').all() as any[];
    return rows.map(row => ({
        id: row.id,
        name: row.name,
        host: row.ssh_host,
        type: row.type,
        url: row.url,
        ssh_host: row.ssh_host,
        ssh_port: row.ssh_port,
        ssh_user: row.ssh_user,
        // SECURITY: Never send sensitive credentials to frontend
        ssh_key: undefined,
        group_name: row.group_name,
        auth_token: undefined,
        ssl_fingerprint: row.ssl_fingerprint
    }));
}

export async function getServer(id: number): Promise<Server | null> {
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        host: row.ssh_host,
        type: row.type,
        url: row.url,
        ssh_host: row.ssh_host,
        ssh_port: row.ssh_port,
        ssh_user: row.ssh_user,
        ssh_key: row.ssh_key,
        group_name: row.group_name,
        auth_token: row.auth_token,
        ssl_fingerprint: row.ssl_fingerprint
    };
}


export async function getServerResources(serverId: number): Promise<{ storages: string[], bridges: string[] }> {
    const server = await getServer(serverId);
    if (!server) throw new Error('Server not found');

    const { createSSHClient } = await import('@/lib/ssh');
    const client = createSSHClient(server);

    try {
        await client.connect();

        // Fetch Bridges
        // List everything in /sys/class/net that starts with vmbr
        const brCmd = `ls /sys/class/net/ | grep "^vmbr" || echo ""`;
        const brOut = await client.exec(brCmd);
        const bridges = brOut.split('\n').map(s => s.trim()).filter(Boolean);
        if (bridges.length === 0) bridges.push('vmbr0'); // Default fallback

        // Fetch Storages
        // Use pvesh to get storage logic
        const stCmd = `pvesh get /storage --output-format json 2>/dev/null || echo "[]"`;
        const stOut = await client.exec(stCmd);
        let storages: string[] = [];
        try {
            const json = JSON.parse(stOut);
            if (Array.isArray(json)) {
                storages = json.map((s: any) => s.storage).filter(Boolean);
            }
        } catch (e) {
            console.warn('Failed to parse storage json', e);
        }

        return { storages, bridges };

    } catch (e) {
        console.error('Failed to fetch server resources:', e);
        return { storages: [], bridges: [] };
    } finally {
        await client.disconnect();
    }
}
