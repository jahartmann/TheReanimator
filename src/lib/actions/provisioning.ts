'use server';

import { getDb } from '@/lib/db';
import { Client } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

// Types
export interface ProvisioningProfile {
    id: number;
    name: string;
    description: string | null;
    icon: string;
    created_at: string;
    steps?: ProvisioningStep[];
}

export interface ProvisioningStep {
    id: number;
    profile_id: number;
    step_order: number;
    step_type: 'script' | 'file' | 'packages';
    name: string;
    content: string;
    target_path: string | null;
}

// --- Profile CRUD ---

export async function getProfiles(): Promise<ProvisioningProfile[]> {
    const db = getDb();
    return db.prepare('SELECT * FROM provisioning_profiles ORDER BY name').all() as ProvisioningProfile[];
}

export async function getProfile(id: number): Promise<ProvisioningProfile | null> {
    const db = getDb();
    const profile = db.prepare('SELECT * FROM provisioning_profiles WHERE id = ?').get(id) as ProvisioningProfile | undefined;
    if (!profile) return null;

    profile.steps = db.prepare('SELECT * FROM provisioning_steps WHERE profile_id = ? ORDER BY step_order').all(id) as ProvisioningStep[];
    return profile;
}

export async function createProfile(data: { name: string; description?: string; icon?: string }): Promise<{ success: boolean; id?: number; error?: string }> {
    const db = getDb();
    try {
        const result = db.prepare('INSERT INTO provisioning_profiles (name, description, icon) VALUES (?, ?, ?)').run(
            data.name,
            data.description || null,
            data.icon || 'settings'
        );
        return { success: true, id: result.lastInsertRowid as number };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function updateProfile(id: number, data: { name?: string; description?: string; icon?: string }): Promise<{ success: boolean; error?: string }> {
    const db = getDb();
    try {
        const updates: string[] = [];
        const values: any[] = [];

        if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name); }
        if (data.description !== undefined) { updates.push('description = ?'); values.push(data.description); }
        if (data.icon !== undefined) { updates.push('icon = ?'); values.push(data.icon); }

        if (updates.length === 0) return { success: true };

        values.push(id);
        db.prepare(`UPDATE provisioning_profiles SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function deleteProfile(id: number): Promise<{ success: boolean; error?: string }> {
    const db = getDb();
    try {
        db.prepare('DELETE FROM provisioning_profiles WHERE id = ?').run(id);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

// --- Step CRUD ---

export async function addStep(profileId: number, step: { name: string; step_type: 'script' | 'file' | 'packages'; content: string; target_path?: string }): Promise<{ success: boolean; id?: number; error?: string }> {
    const db = getDb();
    try {
        // Get max step_order
        const maxOrder = db.prepare('SELECT MAX(step_order) as max FROM provisioning_steps WHERE profile_id = ?').get(profileId) as { max: number | null };
        const newOrder = (maxOrder.max || 0) + 1;

        const result = db.prepare('INSERT INTO provisioning_steps (profile_id, step_order, step_type, name, content, target_path) VALUES (?, ?, ?, ?, ?, ?)').run(
            profileId,
            newOrder,
            step.step_type,
            step.name,
            step.content,
            step.target_path || null
        );
        return { success: true, id: result.lastInsertRowid as number };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function updateStep(stepId: number, data: { name?: string; step_type?: string; content?: string; target_path?: string; step_order?: number }): Promise<{ success: boolean; error?: string }> {
    const db = getDb();
    try {
        const updates: string[] = [];
        const values: any[] = [];

        if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name); }
        if (data.step_type !== undefined) { updates.push('step_type = ?'); values.push(data.step_type); }
        if (data.content !== undefined) { updates.push('content = ?'); values.push(data.content); }
        if (data.target_path !== undefined) { updates.push('target_path = ?'); values.push(data.target_path); }
        if (data.step_order !== undefined) { updates.push('step_order = ?'); values.push(data.step_order); }

        if (updates.length === 0) return { success: true };

        values.push(stepId);
        db.prepare(`UPDATE provisioning_steps SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function deleteStep(stepId: number): Promise<{ success: boolean; error?: string }> {
    const db = getDb();
    try {
        db.prepare('DELETE FROM provisioning_steps WHERE id = ?').run(stepId);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function reorderSteps(profileId: number, stepIds: number[]): Promise<{ success: boolean; error?: string }> {
    const db = getDb();
    try {
        const updateStmt = db.prepare('UPDATE provisioning_steps SET step_order = ? WHERE id = ? AND profile_id = ?');
        stepIds.forEach((stepId, index) => {
            updateStmt.run(index + 1, stepId, profileId);
        });
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

// --- Apply Profile ---

async function executeSSHCommand(conn: Client, cmd: string): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
        conn.exec(cmd, (err, stream) => {
            if (err) {
                resolve({ success: false, output: err.message });
                return;
            }

            let output = '';
            stream.on('data', (data: Buffer) => { output += data.toString(); });
            stream.stderr.on('data', (data: Buffer) => { output += data.toString(); });
            stream.on('close', (code: number) => {
                resolve({ success: code === 0, output });
            });
        });
    });
}

export async function applyProfile(
    serverId: number,
    profileId: number,
    serverType: 'linux' | 'pve'
): Promise<{ success: boolean; message?: string; error?: string; stepResults?: { name: string; success: boolean; output: string }[] }> {
    const db = getDb();

    // Get server details
    let server: any;
    if (serverType === 'linux') {
        server = db.prepare('SELECT * FROM linux_hosts WHERE id = ?').get(serverId);
    } else {
        server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    }

    if (!server) {
        return { success: false, error: 'Server not found' };
    }

    // Get profile with steps
    const profile = await getProfile(profileId);
    if (!profile || !profile.steps || profile.steps.length === 0) {
        return { success: true, message: 'Profile is empty, nothing to apply' };
    }

    // Determine SSH connection details
    const host = serverType === 'linux' ? server.hostname : (server.ssh_host || new URL(server.url).hostname);
    const port = serverType === 'linux' ? server.port : (server.ssh_port || 22);
    const username = serverType === 'linux' ? server.username : (server.ssh_user || 'root');

    // Determine private key path
    let privateKeyPath = serverType === 'linux' ? server.ssh_key_path : null;
    if (!privateKeyPath) {
        privateKeyPath = path.join(homedir(), '.ssh', 'id_rsa');
    }

    let privateKey: string;
    try {
        privateKey = fs.readFileSync(privateKeyPath, 'utf-8');
    } catch (e) {
        return { success: false, error: `Cannot read SSH private key at ${privateKeyPath}` };
    }

    // Connect via SSH
    const conn = new Client();
    const stepResults: { name: string; success: boolean; output: string }[] = [];

    return new Promise((resolve) => {
        conn.on('ready', async () => {
            try {
                for (const step of profile.steps!) {
                    let result: { success: boolean; output: string };

                    switch (step.step_type) {
                        case 'script':
                            // Execute the script content directly
                            result = await executeSSHCommand(conn, step.content);
                            break;

                        case 'packages':
                            // Parse JSON array of packages and install them
                            try {
                                const packages = JSON.parse(step.content) as string[];
                                const installCmd = `apt-get update && apt-get install -y ${packages.join(' ')}`;
                                result = await executeSSHCommand(conn, installCmd);
                            } catch (e) {
                                result = { success: false, output: 'Invalid package list JSON' };
                            }
                            break;

                        case 'file':
                            // Upload file via SFTP
                            if (!step.target_path) {
                                result = { success: false, output: 'No target path specified for file upload' };
                            } else {
                                result = await new Promise((res) => {
                                    conn.sftp((err, sftp) => {
                                        if (err) {
                                            res({ success: false, output: err.message });
                                            return;
                                        }

                                        const writeStream = sftp.createWriteStream(step.target_path!);
                                        writeStream.on('error', (e: Error) => {
                                            res({ success: false, output: e.message });
                                        });
                                        writeStream.on('close', () => {
                                            res({ success: true, output: `File uploaded to ${step.target_path}` });
                                        });
                                        writeStream.end(step.content);
                                    });
                                });
                            }
                            break;

                        default:
                            result = { success: false, output: `Unknown step type: ${step.step_type}` };
                    }

                    stepResults.push({ name: step.name, ...result });
                }

                conn.end();

                const allSucceeded = stepResults.every(r => r.success);
                resolve({
                    success: allSucceeded,
                    message: allSucceeded ? `Profile "${profile.name}" applied successfully` : 'Some steps failed',
                    stepResults
                });
            } catch (e: any) {
                conn.end();
                resolve({ success: false, error: e.message, stepResults });
            }
        }).on('error', (err) => {
            resolve({ success: false, error: 'SSH connection failed: ' + err.message });
        }).connect({
            host,
            port,
            username,
            privateKey,
            readyTimeout: 10000
        });
    });
}
