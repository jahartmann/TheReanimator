'use server';

import { getDb } from '@/lib/db';
import { ProxmoxClient } from '@/lib/proxmox';

export async function getProxmoxNodesAction() {
    const db = getDb();
    const servers = db.prepare("SELECT * FROM servers WHERE type = 'pve'").all() as any[];

    const results = [];

    for (const server of servers) {
        try {
            const client = new ProxmoxClient({
                url: server.url,
                username: server.username,
                password: server.password,
                token: server.auth_token,
                type: 'pve'
            });

            // Try to get nodes
            const nodes = await client.getNodes();
            results.push({
                id: server.id,
                name: server.name,
                nodes: nodes.map(n => n.name)
            });
        } catch (e) {
            console.error(`Failed to fetch nodes for server ${server.name}`, e);
            // Fallback: If we can't fetch nodes, assume the server name IS the node name? 
            // Or just skip.
            // Let's assume user might have added a single node directly.
            // But usually API call `/nodes` works even on single node? yes.
            // If checking fails, we might just list the server name itself?
            // "local" node name is risky.
        }
    }
    return results;
}
