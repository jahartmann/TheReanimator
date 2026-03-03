'use server';

import db from '@/lib/db';
import { withSSH } from '@/lib/ssh-pool';
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

    try {
        await withSSH(server, async (ssh) => {
            const colorMap = tags.map(t => {
                const hex = t.color.replace('#', '');
                return `${t.name}:${hex}`;
            }).join(';');

            const cmd = `pvesh set /cluster/options --tag-style "shape=circle,color-map=${colorMap}"`;
            console.log(`[Tags] Pushing to server ${server.name}: ${cmd}`);
            await ssh.exec(cmd);
        });

        return { success: true, message: `${tags.length} Tags übertragen` };
    } catch (e) {
        console.error('[Tags] Push failed:', e);
        return { success: false, message: String(e) };
    }
}

// Sync tags from Proxmox server (legacy / specific server pull)
export async function syncTagsFromProxmox(serverId: number): Promise<{ success: boolean; message?: string }> {
    const server = getServer(serverId);
    if (!server) return { success: false, message: 'Server not found' };

    try {
        const result = await withSSH(server, async (ssh) => {
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

            return colorMapStr;
        });

        if (!result) {
            return await scanAllClusterTags();
        }

        const tags = result.split(';').map((t: string) => {
            const [name, color] = t.split(':');
            return { name, color };
        }).filter((t: { name: string, color: string }) => t.name && t.color);

        const insertStmt = db.prepare('INSERT INTO tags (name, color) VALUES (@name, @color) ON CONFLICT(name) DO UPDATE SET color=excluded.color');
        const updateTags = db.transaction((tagsToInsert: { name: string; color: string }[]) => {
            for (const tag of tagsToInsert) {
                insertStmt.run(tag);
            }
        });
        updateTags(tags);

        return { success: true, message: `Synced ${tags.length} tags` };
    } catch (e) {
        console.error('[Tags] Sync failed:', e);
        return { success: false, message: String(e) };
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

    try {
        await withSSH(server, async (ssh) => {
            const tagString = tags.map(t => t.trim()).join(',');

            const findCmd = `pvesh get /cluster/resources --type vm --output-format json`;
            const resourcesJson = await ssh.exec(findCmd);
            const resources = JSON.parse(resourcesJson);
            const resource = resources.find((r: any) => r.vmid == vmid);

            if (!resource) throw new Error('Resource not found');

            const { node, type } = resource;
            const cmd = `pvesh set /nodes/${node}/${type}/${vmid}/config -tags "${tagString}"`;

            console.log(`[Tags] Assigning to ${vmid} on ${node}: ${cmd}`);
            await ssh.exec(cmd);
        });

        return { success: true };
    } catch (e) {
        console.error('[Tags] Assign failed:', e);
        return { success: false, message: String(e) };
    }
}

// Extract tags from VM list
function extractTags(vmList: any[]): string[] {
    const tags: string[] = [];
    for (const vm of vmList) {
        if (vm.tags) {
            const tList = typeof vm.tags === 'string' ? vm.tags.split(',') : [];
            tList.forEach((t: string) => { if (t.trim()) tags.push(t.trim()); });
        }
    }
    return tags;
}

// Scan all tags from all servers (VMs/LXCs) — parallel
export async function scanAllClusterTags(): Promise<{ success: boolean; message: string; count: number }> {
    const servers = await getServers();
    const foundTags = new Set<string>();
    let errorCount = 0;
    let scannedNodes = 0;

    // Scan all servers in parallel
    const results = await Promise.allSettled(
        servers.map(async (server) => {
            console.log(`[Tags] Scanning server ${server.name} for tags...`);

            return await withSSH(server, async (ssh) => {
                let nodes: any[] = [];
                try {
                    const nodesJson = await ssh.exec('pvesh get /nodes --output-format json');
                    nodes = JSON.parse(nodesJson);
                } catch {
                    const hostname = (await ssh.exec('cat /etc/hostname')).trim();
                    nodes = [{ node: hostname }];
                }

                const serverTags: string[] = [];
                let nodeCount = 0;

                // Scan nodes: QEMU + LXC in parallel per node
                for (const nodeObj of nodes) {
                    const nodeName = nodeObj.node;
                    nodeCount++;

                    const [qemuResult, lxcResult] = await Promise.allSettled([
                        ssh.exec(`pvesh get /nodes/${nodeName}/qemu --output-format json`).then(json => extractTags(JSON.parse(json))),
                        ssh.exec(`pvesh get /nodes/${nodeName}/lxc --output-format json`).then(json => extractTags(JSON.parse(json))),
                    ]);

                    if (qemuResult.status === 'fulfilled') serverTags.push(...qemuResult.value);
                    if (lxcResult.status === 'fulfilled') serverTags.push(...lxcResult.value);
                }

                return { tags: serverTags, nodeCount };
            });
        })
    );

    for (const result of results) {
        if (result.status === 'fulfilled') {
            result.value.tags.forEach(t => foundTags.add(t));
            scannedNodes += result.value.nodeCount;
        } else {
            errorCount++;
            console.error(`[Tags] Server scan failed:`, result.reason);
        }
    }

    // Sync found tags to DB
    const insertStmt = db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)');
    let newCount = 0;

    try {
        db.exec("CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL)");
    } catch { }

    const existingTags = new Set((db.prepare('SELECT name FROM tags').all() as Tag[]).map(t => t.name));
    const defaultColors = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#1A535C', '#F7FFF7', '#3B82F6', '#8B5CF6', '#EC4899'];

    for (const tagName of Array.from(foundTags).filter(t => t && t.length > 0)) {
        if (!existingTags.has(tagName)) {
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
