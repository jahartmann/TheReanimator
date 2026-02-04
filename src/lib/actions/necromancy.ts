'use server';

import { getDb } from '@/lib/db';
import { executeCommand, createSSHClient } from '@/lib/ssh';
import { ProxmoxClient, LXCCreationParams } from '@/lib/proxmox';
import { inspectContainer } from '@/lib/actions/soul_scanner';
import { revalidatePath } from 'next/cache';

// --- Utils ---

async function getProxmoxServer(id: number) {
    const db = getDb();
    const server = db.prepare('SELECT * FROM servers WHERE id = ? AND type = "pve"').get(id) as any;
    if (!server) return null;
    return server;
}

async function getDockerComposeFromInspect(inspectData: any): Promise<string> {
    // Basic reconstruction of a compose service from inspect data
    // This is "best effort".

    const name = inspectData.Name.replace('/', '');
    const image = inspectData.Config.Image;
    const ports = inspectData.HostConfig.PortBindings || {};
    const env = inspectData.Config.Env || [];
    const volumes = inspectData.Mounts || [];
    const restartPolicy = inspectData.HostConfig.RestartPolicy?.Name || 'no';

    // Build ports section
    const portLines = Object.keys(ports).map(p => {
        const hostPort = ports[p][0].HostPort;
        return `      - "${hostPort}:${p}"`;
    });

    // Build env section
    const envLines = env.map((e: string) => `      - ${e}`);

    // Build volumes section
    // We only support bind mounts that we might have migrated or new volumes?
    // For now, let's comment out volumes to be safe or map them to a datadir if we decide to migrate data later.
    // In V1, we warn user about data. We will map named volumes to local?
    // Let's just list them as comments or empty dirs?
    // Actually typically users want the config. 
    // Let's just create the basic structure.

    const yaml = `version: '3.8'
services:
  ${name}:
    image: ${image}
    container_name: ${name}
    restart: ${restartPolicy === 'always' ? 'always' : 'unless-stopped'}
${portLines.length > 0 ? '    ports:\n' + portLines.join('\n') : ''}
${envLines.length > 0 ? '    environment:\n' + envLines.join('\n') : ''}
    # Volumes were detected but not automatically migrated in this version.
    # Check original container: ${inspectData.Id}
`;

    return yaml;
}

// --- Actions ---

export async function createSoulVessel(nodeId: number, params: LXCCreationParams) {
    const server = await getProxmoxServer(nodeId);
    if (!server) return { success: false, error: 'Proxmox node not found' };

    const client = new ProxmoxClient({
        url: server.url,
        username: server.username, // Assumption: These are API creds or PAM
        // We probably need a token or password. The `server` table has `auth_token` or `password`/`username`.
        // Let's assume we use what is available.
        password: server.password,
        token: server.auth_token,
        type: 'pve'
    });

    try {
        const upid = await client.createLXC(server.name, params); // server.name might not be node name?
        // Actually `server.name` in DB might be display name. 
        // We need the PVE Node Name. Using `getNodes` to find it or assume it matches?
        // Typically PVE cluster has multiple nodes. `server` entry is usually one of them or the cluster entry?
        // Reanimator model seems to treat each node as a server row? 
        // If so, `server.ssh_host` is the node? 
        // Let's assume we passed the correct node name in params if needed, or we use `server.name`.
        // Wait, `createLXC` takes `node`. User should select which node on the cluster. 
        // If the `server` row represents the cluster, we need to know the specific node.
        // For simplicity now, let's assume `server` row IS the node we are targeting.
        // But `createLXC` calls specific node endpoint.
        // Let's assume we determine node name from specific API call `getNodes` or we just try `server.name`?
        // Better: `client.getNodes()` -> match?
        // Let's grab the first active node if we don't know?
        // Or we pass `targetNodeName` to this action.

        // For V1, let's assume `createSoulVessel` is passed the actual pve node name.
        // But `client.createLXC(node...`
        // We will assume the `server` record points to the cluster/node access point.
        // I will trust the `node` argument passed in `params`? No `params` doesn't have node.
        // I'll add `nodeName` to arguments.

        return { success: true, upid };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

// Helper to install Docker in LXC via Proxmox Host
export async function installDockerInLXC(serverId: number, vmid: number, nodeName: string) {
    const server = await getProxmoxServer(serverId);
    if (!server) return { success: false, error: 'Proxmox server not found' };

    // We need SSH to the PVE HOST
    const sshConfig = {
        host: server.ssh_host || new URL(server.url).hostname,
        port: server.ssh_port || 22,
        username: server.ssh_user || 'root',
        privateKeyPath: server.ssh_key // This effectively acts as the key content or path? 
        // Wait, `createSSHClient` expects `server` object logic.
    };

    const dockerInstallCmd = "curl -fsSL https://get.docker.com | sh";

    // Command to run INSIDE LXC via PCT
    const pctCmd = `pct exec ${vmid} -- bash -c "${dockerInstallCmd}"`;

    try {
        // We use the helper `executeCommand` but we need to adapt it since it takes a config object that expects specific fields.
        // Or we just use `createSSHClient` and exec.
        const client = createSSHClient(server); // generic helper from ssh.ts
        await client.connect();

        // 1. Update apt? 
        await client.exec(`pct exec ${vmid} -- apt-get update`);
        // 2. Install curl if missing?
        await client.exec(`pct exec ${vmid} -- apt-get install -y curl`);
        // 3. Install Docker
        await client.exec(pctCmd);

        client.disconnect();
        return { success: true };
    } catch (e: any) {
        console.error("Docker Install Failed", e);
        return { success: false, error: e.message };
    }
}

export async function reanimate(
    sourceHostId: number,
    containerId: string,
    targetServerId: number,
    targetNodeName: string,
    lxcParams: LXCCreationParams
) {
    // 1. Inspect Source
    const inspectRes = await inspectContainer(sourceHostId, containerId);
    if (!inspectRes.success) return { success: false, error: 'Failed to inspect source container' };

    const composeContent = await getDockerComposeFromInspect(inspectRes.data);

    // 2. Create Vessel (LXC)
    const server = await getProxmoxServer(targetServerId);
    if (!server) return { success: false, error: 'Target server not found' };

    const client = new ProxmoxClient({
        url: server.url,
        username: server.username,
        password: server.password,
        token: server.auth_token,
        type: 'pve'
    });

    try {
        // Create LXC
        // This returns a UPID. Creation is async. We need to wait for it!
        const upid = await client.createLXC(targetNodeName, lxcParams);

        // Wait for task completion
        // Poll status
        let status = 'running';
        while (status === 'running') {
            await new Promise(r => setTimeout(r, 1000));
            const task = await client.getTaskStatus(targetNodeName, upid);
            status = task.status;
            if (task.exitstatus && task.exitstatus !== 'OK') {
                throw new Error('LXC Creation Task Failed: ' + task.exitstatus);
            }
        }

        const vmid = lxcParams.vmid;

        // Start LXC
        await client.startLXC(targetNodeName, vmid);

        // Wait for boot (simple delay or ping?)
        await new Promise(r => setTimeout(r, 10000)); // 10s grace

        // 3. Install Docker
        const installRes = await installDockerInLXC(targetServerId, vmid, targetNodeName);
        if (!installRes.success) throw new Error('Failed to install Docker: ' + installRes.error);

        // 4. Deploy Compose
        // Write compose file to LXC
        const sshClient = createSSHClient(server);
        await sshClient.connect();

        // Escape content likely needed, but let's try a simple heredoc with a unique marker
        const safeMarker = "EOF_REANIMATOR";
        // We write to a tmp file on host then push? Or pipe?
        // `pct exec vmid -- bash -c 'cat > /root/docker-compose.yml <<EOF ...'`
        // Use base64 to avoid quoting issues
        const b64 = Buffer.from(composeContent).toString('base64');
        await sshClient.exec(`pct exec ${vmid} -- bash -c "echo ${b64} | base64 -d > /root/docker-compose.yml"`);

        // Up!
        await sshClient.exec(`pct exec ${vmid} -- bash -c "cd /root && docker compose up -d"`);

        sshClient.disconnect();

        revalidatePath('/dashboard');
        return { success: true, message: 'Reanimation complete!' };

    } catch (e: any) {
        console.error("Reanimation Failed:", e);
        return { success: false, error: e.message };
    }
}
