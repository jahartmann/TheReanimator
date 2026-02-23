'use server';

import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';
import { getServers } from './server';

// server actions for managing tags
export interface Tag {
    id: number;
    name: string;
    color: string;
}

interface Server {
    id: number;
    name: string;
    ssh_host: string;
    ssh_port: number;
    ssh_user: string;
    ssh_key: string;
}

// Get all tags
export async function getTags(): Promise<Tag[]> {
    return db.prepare('SELECT * FROM tags ORDER BY name').all() as Tag[];
}

// Create a new tag
export async function createTag(name: string, color: string): Promise<{ success: boolean; tag?: Tag; error?: string }> {
    try {
        const stmt = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?) RETURNING *');
        const tag = stmt.get(name, color.replace('#', '')) as Tag;
        return { success: true, tag };
    } catch (e: any) {
        if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return { success: false, error: 'Tag already exists' };
        }
        return { success: false, error: String(e) };
    }
}

// Delete a tag
export async function deleteTag(id: number): Promise<{ success: boolean }> {
    db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    return { success: true };
}

// Helper to getting server info
function getServer(serverId: number): Server | null {
    return db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as Server;
}

// Push tags to Proxmox server (set datacenter.cfg)
export async function pushTagsToServer(serverId: number, tags: Tag[]): Promise<{ success: boolean; message?: string }> {
    const server = getServer(serverId);
    if (!server) return { success: false, message: 'Server not found' };

    const ssh = createSSHClient({
        ssh_host: server.ssh_host,
        ssh_port: server.ssh_port,
        ssh_user: server.ssh_user,
        ssh_key: server.ssh_key
    });

    try {
        await ssh.connect();

        // Construct color map: "tag1=color,tag2=color"
        // Proxmox format in datacenter.cfg: tag-style: shape=circle,color-map=tag1:FFFFFF;tag2:000000
        const colorMap = tags.map(t => `${t.name}:${t.color}`).join(';');

        // Using pvesh/pveum might not expose tag-style directly easily, so we can edit the config file.
        // Safer: check if we can using 'pvesh set /cluster/options -tag-style ...'
        // According to stats, 'tag-style' is a cluster option.

        const cmd = `pvesh set /cluster/options -tag-style "shape=circle,color-map=${colorMap}"`;

        console.log(`[Tags] Pushing to server ${server.name}: ${cmd}`);
        const output = await ssh.exec(cmd);

        return { success: true, message: output };
    } catch (e) {
        console.error('[Tags] Push failed:', e);
        return { success: false, message: String(e) };
    } finally {
        await ssh.disconnect();
    }
}

// Sync tags from Proxmox server
export async function syncTagsFromProxmox(serverId: number): Promise<{ success: boolean; message?: string }> {
    const server = getServer(serverId);
    if (!server) return { success: false, message: 'Server not found' };

    const ssh = createSSHClient({
        ssh_host: server.ssh_host,
        ssh_port: server.ssh_port,
        ssh_user: server.ssh_user,
        ssh_key: server.ssh_key
    });

    try {
        await ssh.connect();

        // Getting all resources to extract tags
        const output = await ssh.exec('pvesh get /cluster/resources --output-format json');
        const resources = JSON.parse(output);

        const foundTags = new Set<string>();
        resources.forEach((r: any) => {
            if (r.tags) {
                const tList = r.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t);
                tList.forEach((t: string) => foundTags.add(t));
            }
        });

        // Sync found tags to DB (if not exist)
        const insertStmt = db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)');
        let newCount = 0;
        const existingTags = new Set((db.prepare('SELECT name FROM tags').all() as Tag[]).map(t => t.name));

        const defaultColors = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#1A535C', '#F7FFF7'];

        db.transaction(() => {
            for (const tagName of Array.from(foundTags)) {
                if (!existingTags.has(tagName)) {
                    // Assign random default color
                    const color = defaultColors[Math.floor(Math.random() * defaultColors.length)];
                    insertStmt.run(tagName, color);
                    newCount++;
                }
            }
        })();

        return { success: true, message: `Synced ${foundTags.size} tags. Added ${newCount} new tags.` };
    } catch (e) {
        console.error('[Tags] Sync failed:', e);
        return { success: false, message: String(e) };
    } finally {
        await ssh.disconnect();
    }
}

// Assign tags to a specific resource (VM or Container)
export async function assignTagsToResource(
    serverId: number,
    vmid: string | number,
    tags: string[]
): Promise<{ success: boolean; message?: string }> {
    const server = getServer(serverId);
    if (!server) return { success: false, message: 'Server not found' };

    const ssh = createSSHClient({
        ssh_host: server.ssh_host,
        ssh_port: server.ssh_port,
        ssh_user: server.ssh_user,
        ssh_key: server.ssh_key
    });

    try {
        await ssh.connect();

        // Check if vmid exists and if it is qemu or lxc (plus which node it is on!)
        const findCmd = `pvesh get /cluster/resources --type vm --output-format json`;
        const resourcesJson = await ssh.exec(findCmd);
        const resources = JSON.parse(resourcesJson);
        const resource = resources.find((r: any) => r.vmid == vmid);

        if (!resource) return { success: false, message: 'Resource not found' };

        const { node, type } = resource; // type is 'qemu' or 'lxc'

        const tagString = tags.map(t => t.trim().replace(/\s/g, '_')).filter(Boolean).join(',');

        // Using safe API assignment method that doesn't overwrite unrelated VM config properties!
        const cmd = `pvesh set /nodes/${node}/${type}/${vmid}/config -tags "${tagString}"`;

        console.log(`[Tags] Assigning to ${vmid} on ${node}: ${cmd}`);
        await ssh.exec(cmd);

        return { success: true };
    } catch (e) {
        console.error('[Tags] Assign failed:', e);
        return { success: false, message: String(e) };
    } finally {
        await ssh.disconnect();
    }
}

// Scan all tags from all servers (VMs/LXCs)
export async function scanAllClusterTags(): Promise<{ success: boolean; message: string; count: number }> {
    const servers = await getServers();
    const foundTags = new Set<string>();
    let errorCount = 0;

    for (const server of servers) {
        try {
            const ssh = createSSHClient({
                ssh_host: server.ssh_host,
                ssh_port: server.ssh_port,
                ssh_user: server.ssh_user,
                ssh_key: server.ssh_key
            });
            await ssh.connect();

            // Get all resources to extract tags
            const output = await ssh.exec('pvesh get /cluster/resources --output-format json');
            const resources = JSON.parse(output);

            resources.forEach((r: any) => {
                if (r.tags) {
                    const tList = r.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t);
                    tList.forEach((t: string) => foundTags.add(t));
                }
            });

            await ssh.disconnect();
        } catch (e) {
            console.error(`Error scanning tags on server ${server.name}:`, e);
            errorCount++;
        }
    }

    // Sync found tags to DB (if not exist)
    const insertStmt = db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)');
    let newCount = 0;
    const existingTags = new Set((db.prepare('SELECT name FROM tags').all() as Tag[]).map(t => t.name));

    const defaultColors = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#1A535C', '#F7FFF7'];

    for (const tagName of Array.from(foundTags)) {
        if (!existingTags.has(tagName)) {
            // Assign random default color
            const color = defaultColors[Math.floor(Math.random() * defaultColors.length)];
            insertStmt.run(tagName, color);
            newCount++;
        }
    }

    return {
        success: true,
        message: `Scanned ${servers.length} servers. Found ${foundTags.size} unique tags. Added ${newCount} new tags. Errors on ${errorCount} servers.`,
        count: newCount
    };
}
