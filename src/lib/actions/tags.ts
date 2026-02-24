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

        // Build color-map string: "tag1:RRGGBB;tag2:RRGGBB"
        const colorMap = tags.map(t => {
            const hex = t.color.replace('#', '');
            return `${t.name}:${hex}`;
        }).join(';');

        // pvesh uses -- flags; -tag-style (single dash) is wrong and silently ignored
        const cmd = `pvesh set /cluster/options --tag-style "shape=circle,color-map=${colorMap}"`;

        console.log(`[Tags] Pushing to server ${server.name}: ${cmd}`);
        await ssh.exec(cmd);

        return { success: true, message: `${tags.length} Tags übertragen` };
    } catch (e) {
        console.error('[Tags] Push failed:', e);
        return { success: false, message: String(e) };
    } finally {
        await ssh.disconnect();
    }
}

// Sync tags from Proxmox server (legacy / specific server pull)
export async function syncTagsFromProxmox(serverId: number): Promise<{ success: boolean; message?: string }> {
    // Re-use robust scan logic but filter for single server if needed, 
    // or just keep this simple implementation for specific server sync button
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

        const output = await ssh.exec('pvesh get /cluster/options --output-format json');
        const options = JSON.parse(output);
        const tagStyle = options['tag-style'];

        let colorMapStr: string | null = null;
        if (typeof tagStyle === 'string') {
            const m = tagStyle.match(/color-map=([^,]+)/);
            colorMapStr = m ? m[1] : null;
        } else if (tagStyle && typeof tagStyle === 'object') {
            colorMapStr = tagStyle['color-map'] || null;
        }

        if (!colorMapStr) {
            // Fallback: Scan resources if no global map
            return await scanAllClusterTags();
        }

        const tags = colorMapStr.split(';').map((t: string) => {
            const [name, color] = t.split(':');
            return { name, color };
        }).filter((t: { name: string, color: string }) => t.name && t.color);

        // Update local DB
        const insertStmt = db.prepare('INSERT INTO tags (name, color) VALUES (@name, @color) ON CONFLICT(name) DO UPDATE SET color=excluded.color');

        const updateTags = db.transaction((tagsToInsert) => {
            for (const tag of tagsToInsert) {
                insertStmt.run(tag);
            }
        });

        updateTags(tags);

        return { success: true, message: `Synced ${tags.length} tags` };
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

        const tagString = tags.map(t => t.trim()).join(',');

        // Search for the VM to get node and type
        const findCmd = `pvesh get /cluster/resources --type vm --output-format json`;
        const resourcesJson = await ssh.exec(findCmd);
        const resources = JSON.parse(resourcesJson);
        const resource = resources.find((r: any) => r.vmid == vmid);

        if (!resource) return { success: false, message: 'Resource not found' };

        const { node, type } = resource; // type is 'qemu' or 'lxc'

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
    let scannedNodes = 0;

    for (const server of servers) {
        try {
            console.log(`[Tags] Connecting to server ${server.name} (${server.host}) for tag scan...`);
            const ssh = createSSHClient({
                ssh_host: server.ssh_host,
                ssh_port: server.ssh_port,
                ssh_user: server.ssh_user,
                ssh_key: server.ssh_key
            });
            await ssh.connect();

            // 1. Discover nodes in this cluster (or standalone node)
            const nodesJson = await ssh.exec('pvesh get /nodes --output-format json');
            let nodes = [];
            try {
                nodes = JSON.parse(nodesJson);
            } catch (e) {
                console.warn('[Tags] Failed to parse nodes json, using fallback (hostname)', e);
                const hostname = (await ssh.exec('cat /etc/hostname')).trim();
                nodes = [{ node: hostname }];
            }

            console.log(`[Tags] Found ${nodes.length} nodes on server ${server.name}:`, nodes.map((n: any) => n.node).join(', '));

            for (const nodeObj of nodes) {
                const nodeName = nodeObj.node;
                scannedNodes++;

                // 2. Get QEMU VMs for this node
                try {
                    const qemuJson = await ssh.exec(`pvesh get /nodes/${nodeName}/qemu --output-format json`);
                    const qemuList = JSON.parse(qemuJson);
                    qemuList.forEach((vm: any) => {
                        if (vm.tags) {
                            const tList = typeof vm.tags === 'string' ? vm.tags.split(',') : [];
                            tList.forEach((t: string) => foundTags.add(t.trim()));
                        }
                    });
                } catch (e) {
                    console.warn(`[Tags] Failed to fetch QEMU for node ${nodeName}`, e);
                }

                // 3. Get LXC Containers for this node
                try {
                    const lxcJson = await ssh.exec(`pvesh get /nodes/${nodeName}/lxc --output-format json`);
                    const lxcList = JSON.parse(lxcJson);
                    lxcList.forEach((vm: any) => {
                        if (vm.tags) {
                            const tList = typeof vm.tags === 'string' ? vm.tags.split(',') : [];
                            tList.forEach((t: string) => foundTags.add(t.trim()));
                        }
                    });
                } catch (e) {
                    console.warn(`[Tags] Failed to fetch LXC for node ${nodeName}`, e);
                }
            }

            await ssh.disconnect();
        } catch (e) {
            console.error(`Error scanning tags on server ${server.name}:`, e);
            errorCount++;
        }
    }

    // Sync found tags to DB (if not exist)
    const insertStmt = db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)');
    let newCount = 0;

    // Ensure table exists just in case (though init script handles it)
    try {
        db.exec("CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL)");
    } catch { }

    const existingTags = new Set((db.prepare('SELECT name FROM tags').all() as Tag[]).map(t => t.name));

    const defaultColors = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#1A535C', '#F7FFF7', '#3B82F6', '#8B5CF6', '#EC4899'];

    for (const tagName of Array.from(foundTags).filter(t => t && t.length > 0)) {
        if (!existingTags.has(tagName)) {
            // Assign random default color
            const color = defaultColors[Math.floor(Math.random() * defaultColors.length)];
            insertStmt.run(tagName, color);
            newCount++;
        }
    }

    return {
        success: true,
        message: `Scanned ${servers.length} servers (${scannedNodes} nodes). Found ${foundTags.size} unique tags. Added ${newCount} new tags. Errors on ${errorCount} servers.`,
        count: newCount
    };
}
