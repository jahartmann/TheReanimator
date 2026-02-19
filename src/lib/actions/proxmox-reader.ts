import { ProxmoxClient, NodeInfo, VMInfo } from '@/lib/proxmox';
import db from '@/lib/db';

function getProxmoxClient() {
    // 1. Try DB first
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('proxmox_config') as { value: string } | undefined;
    if (row) {
        try {
            const config = JSON.parse(row.value);
            return new ProxmoxClient(config);
        } catch (e) {
            console.error("Invalid Proxmox Configuration in DB", e);
        }
    }

    // 2. Fallback to Env Vars
    if (process.env.PROXMOX_URL) {
        return new ProxmoxClient({
            url: process.env.PROXMOX_URL,
            username: process.env.PROXMOX_USERNAME,
            password: process.env.PROXMOX_PASSWORD,
            token: process.env.PROXMOX_TOKEN, // Optional
            type: (process.env.PROXMOX_TYPE as 'pve' | 'pbs') || 'pve'
        });
    }

    return null;
}

export async function getProxmoxNodes(): Promise<NodeInfo[] | null> {
    const client = getProxmoxClient();
    if (!client) return null;
    try {
        return await client.getNodes();
    } catch (e) {
        console.error("Failed to get Proxmox nodes", e);
        return null;
    }
}

export async function getProxmoxVMs(): Promise<VMInfo[] | null> {
    const client = getProxmoxClient();
    if (!client) return null;
    try {
        const nodes = await client.getNodes();
        let allVMs: VMInfo[] = [];
        for (const node of nodes) {
            const vms = await client.getVMs(node.name);
            allVMs = [...allVMs, ...vms];
        }
        return allVMs;
    } catch (e) {
        console.error("Failed to get Proxmox VMs", e);
        return null;
    }
}
