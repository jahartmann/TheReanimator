import db from '@/lib/db';
import { ProxmoxClient, NodeInfo } from '@/lib/proxmox';
import { Server } from '@/lib/actions/server'; // Reusing type

// Internal helper to get all servers with credentials
async function getAllServersWithCreds(): Promise<Server[]> {
    const rows = db.prepare('SELECT * FROM servers').all() as any[];
    return rows.map(row => ({
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
    }));
}

export async function listNodes(): Promise<string> {
    const servers = await getAllServersWithCreds();
    const results: { server: string, nodes: NodeInfo[], error?: string }[] = [];

    for (const server of servers) {
        if (server.type !== 'pve') continue; // Skip PBS for node listing (PBS has datastores)

        try {
            const client = new ProxmoxClient({
                url: server.url,
                type: server.type,
                username: server.ssh_user, // Assuming ssh_user is also PAM user, usually true for root
                password: server.ssh_key // Assuming key column holds password for PAM
            });

            const nodes = await client.getNodes();
            results.push({ server: server.name, nodes });

        } catch (e: any) {
            results.push({ server: server.name, nodes: [], error: e.message });
        }
    }

    if (results.length === 0) return "No Proxmox servers found.";

    // Format as concise text for LLM
    let output = "Current Infrastructure Status:\n";
    for (const res of results) {
        output += `Server: ${res.server}\n`;
        if (res.error) {
            output += `  Error: ${res.error}\n`;
            continue;
        }
        for (const node of res.nodes) {
            output += `  - Node: ${node.name} (${node.status})\n`;
            output += `    CPU: ${Math.round(node.cpu * 100)}% | RAM: ${node.memory.usagePercent}% (${Math.round(node.memory.used / 1024 / 1024 / 1024)}GB used)\n`;
            output += `    Uptime: ${Math.round(node.uptime / 3600)}h\n`;
        }
    }
    return output;
}

export async function getStorageStatus(): Promise<string> {
    const servers = await getAllServersWithCreds();
    let output = "Storage Status:\n";

    for (const server of servers) {
        try {
            const client = new ProxmoxClient({
                url: server.url,
                type: server.type,
                username: server.ssh_user,
                password: server.ssh_key
            });

            const storages = await client.getStorages();
            output += `Server: ${server.name} (${server.type})\n`;
            for (const store of storages) {
                if (!store.active) continue;
                const sizeGB = Math.round(store.total / 1024 / 1024 / 1024);
                const freeGB = Math.round(store.available / 1024 / 1024 / 1024);
                output += `  - ${store.name}: ${store.usagePercent}% used (${freeGB}GB free / ${sizeGB}GB total) [${store.type}]\n`;
            }

        } catch (e: any) {
            output += `  Server ${server.name} Error: ${e.message}\n`;
        }
    }
    return output;
}

export async function createVM(serverName: string, node: string, params: { name: string, cores: number, memory: number, storage: string, iso?: string }): Promise<string> {
    const servers = await getAllServersWithCreds();
    const server = servers.find(s => s.name === serverName);
    if (!server) return `Server '${serverName}' not found.`;

    try {
        const client = new ProxmoxClient({
            url: server.url,
            type: server.type,
            username: server.ssh_user,
            password: server.ssh_key
        });

        // 1. SMART STORAGE SELECTION
        let targetStorage = params.storage;
        const allStorages = await client.getStorages(node);

        // If storage is "default", "any" or empty, pick the one with most space
        if (!targetStorage || targetStorage === 'default' || targetStorage === 'any') {
            const best = allStorages
                .filter(s => s.active && s.content.includes('images')) // VMs need 'images' content
                .sort((a, b) => b.available - a.available)[0];

            if (!best) throw new Error(`No suitable storage found on node ${node} for VM images.`);
            targetStorage = best.id;
        } else {
            // Verify requested storage exists
            const exists = allStorages.find(s => s.id === targetStorage);
            if (!exists) {
                // Fuzzy match fallback?
                const similar = allStorages.find(s => s.id.includes(targetStorage) && s.content.includes('images'));
                if (similar) {
                    targetStorage = similar.id;
                } else {
                    throw new Error(`Storage '${targetStorage}' not found on ${node}. Available: ${allStorages.map(s => s.id).join(', ')}`);
                }
            }
        }

        // 2. SMART ISO SELECTION
        let isoVolid = params.iso;
        let osType = 'l26'; // Default Linux 2.6+

        if (isoVolid && isoVolid !== 'none') {
            // If the user just said "Debian", we need to find the full path (local:iso/debian-12.iso)
            if (!isoVolid.includes(':')) {
                // Search all storages that support ISOs
                const isoStorages = allStorages.filter(s => s.active && s.content.includes('iso'));
                let foundIso: string | null = null;

                for (const store of isoStorages) {
                    try {
                        const isos = await client.getISOs(node, store.id);
                        // Find match
                        const match = isos.find(iso => iso.volid.toLowerCase().includes(isoVolid!.toLowerCase()));
                        if (match) {
                            foundIso = match.volid;
                            break;
                        }
                    } catch (e) {
                        console.warn(`Failed to list ISOs on ${store.id}`, e);
                    }
                }

                if (foundIso) {
                    isoVolid = foundIso;
                } else {
                    return `Error: Could not find any ISO matching '${params.iso}' on server ${serverName}. Please check available ISOs.`;
                }
            }
        }

        // Smart OS Type
        if (isoVolid && isoVolid.toLowerCase().includes('windows')) {
            osType = 'win11';
        }

        // Fetch next ID from cluster
        const vmid = await client.getNextId();

        const upid = await client.createVM(node, {
            vmid,
            name: params.name,
            cores: params.cores,
            memory: params.memory, // MB
            storage: targetStorage,
            iso: isoVolid,
            ostype: osType as any
        });

        return `VM Creation started successfully!\n- **VMID**: ${vmid}\n- **Name**: ${params.name}\n- **Node**: ${node}\n- **Storage**: ${targetStorage}\n- **ISO**: ${isoVolid || 'None'}\n- **Task**: ${upid}`;
    } catch (e: any) {
        console.error("VM Creation Error:", e);
        return `Failed to create VM: ${e.message}`;
    }
}

export async function startVM(serverName: string, node: string, vmid: number): Promise<string> {
    const servers = await getAllServersWithCreds();
    const server = servers.find(s => s.name === serverName);
    if (!server) return `Server '${serverName}' not found.`;

    try {
        const client = new ProxmoxClient({ url: server.url, type: server.type, username: server.ssh_user, password: server.ssh_key });
        const upid = await client.startVM(node, vmid);
        return `VM ${vmid} start requested (UPID: ${upid})`;
    } catch (e: any) {
        return `Failed to start VM: ${e.message}`;
    }
}

export async function stopVM(serverName: string, node: string, vmid: number): Promise<string> {
    const servers = await getAllServersWithCreds();
    const server = servers.find(s => s.name === serverName);
    if (!server) return `Server '${serverName}' not found.`;

    try {
        const client = new ProxmoxClient({ url: server.url, type: server.type, username: server.ssh_user, password: server.ssh_key });
        const upid = await client.stopVM(node, vmid);
        return `VM ${vmid} stop requested (UPID: ${upid})`;
    } catch (e: any) {
        return `Failed to stop VM: ${e.message}`;
    }
}

export async function installPackage(serverName: string, node: string, vmid: number, packageName: string): Promise<string> {
    const servers = await getAllServersWithCreds();
    const server = servers.find(s => s.name === serverName);
    if (!server) return `Server '${serverName}' not found.`;

    try {
        const client = new ProxmoxClient({ url: server.url, type: server.type, username: server.ssh_user, password: server.ssh_key });
        // Use QEMU Guest Agent
        // Command: apt-get install -y <package> (assuming Debian/Ubuntu)
        // This is a heuristic.
        // Heuristic: Sanitize package name to prevent chaining commands if API were loose
        // Allow alphanumerics, hyphens, underscores, dots, plus (e.g. g++). Reject spaces, semicolons, pipes.
        if (!/^[a-zA-Z0-9\-\_\.\+]+$/.test(packageName)) {
            return `Error: Invalid package name '${packageName}'. Only alphanumeric characters, -, _, ., and + are allowed.`;
        }

        const cmd = ['apt-get', 'install', '-y', packageName];
        const res = await client.agentExec(node, vmid, cmd);
        return `Installation command sent via Guest Agent (PID: ${res}). Check VM logs for completion.`;
    } catch (e: any) {
        return `Failed to install package: ${e.message}`;
    }
}
