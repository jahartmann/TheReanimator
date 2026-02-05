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

        // Fetch next ID from cluster
        const vmid = await client.getNextId();

        const upid = await client.createVM(node, {
            vmid,
            name: params.name,
            cores: params.cores,
            memory: params.memory, // MB
            storage: params.storage,
            iso: params.iso
        });

        return `VM Creation started! (VMID: ${vmid}, Task: ${upid})`;
    } catch (e: any) {
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
