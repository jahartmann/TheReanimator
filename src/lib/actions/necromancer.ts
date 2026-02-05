'use server';

import { getDb } from '@/lib/db';
import { addLinuxHost } from '@/lib/actions/linux';
import { applyProfile } from '@/lib/actions/provisioning';
import dgram from 'dgram';
import { Client } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

// --- WOL Helpers ---

function createMagicPacket(mac: string): Buffer {
    const macBytes = mac.split(/[:\-]/).map(b => parseInt(b, 16));
    if (macBytes.length !== 6) throw new Error('Invalid MAC Address');

    const buffer = Buffer.alloc(6 + 16 * 6);

    // Header: 6 bytes of FF
    for (let i = 0; i < 6; i++) {
        buffer[i] = 0xFF;
    }

    // Body: 16 repetitions of MAC
    for (let i = 0; i < 16; i++) {
        const offset = 6 + i * 6;
        for (let j = 0; j < 6; j++) {
            buffer[offset + j] = macBytes[j];
        }
    }
    return buffer;
}

export async function wakeOnLan(serverId: number, type: 'pve' | 'linux') {
    const db = getDb();
    let server;

    if (type === 'pve') {
        server = db.prepare('SELECT name, mac_address FROM servers WHERE id = ?').get(serverId) as any;
    } else {
        server = db.prepare('SELECT name, mac_address FROM linux_hosts WHERE id = ?').get(serverId) as any;
    }

    if (!server || !server.mac_address) {
        return { success: false, error: 'Server not found or no MAC address configured.' };
    }

    const mac = server.mac_address;
    const packet = createMagicPacket(mac);

    return new Promise<{ success: boolean; message?: string; error?: string }>((resolve) => {
        const socket = dgram.createSocket('udp4');
        socket.on('error', (err) => {
            socket.close();
            resolve({ success: false, error: 'WOL Socket Error: ' + err.message });
        });

        // Broadcast to 255.255.255.255 port 9
        socket.send(packet, 0, packet.length, 9, '255.255.255.255', (err) => {
            socket.close();
            if (err) {
                resolve({ success: false, error: 'Failed to send WOL packet: ' + err.message });
            } else {
                resolve({ success: true, message: `Magic packet sent to ${mac} for ${server.name}` });
            }
        });
    });
}

// --- Raise Undead ---

export async function raiseUndead(params: {
    hostname: string;
    port: number;
    username: string;
    description?: string;
    rootPassword?: string;
    publicKeyPath?: string;
    profileId?: number; // Provisioning profile to apply after key installation
}) {
    // 1. Validate inputs
    if (!params.rootPassword) {
        return { success: false, error: 'Root password required for initial connection.' };
    }

    // 2. Load Public Key
    // Default to ~/.ssh/id_rsa.pub or similar
    let pubKeyContent = '';
    const pubPath = params.publicKeyPath || path.join(homedir(), '.ssh', 'id_rsa.pub');

    try {
        if (!fs.existsSync(pubPath)) {
            // Generate one? Too complex for now. Ask user to ensure it exists.
            return { success: false, error: `Public key not found at ${pubPath}. Please generate an SSH key on the Reanimator host first.` };
        }
        pubKeyContent = fs.readFileSync(pubPath, 'utf-8').trim();
    } catch (e: any) {
        return { success: false, error: 'Failed to read public key: ' + e.message };
    }

    // 3. Connect via Password and Install Key
    const conn = new Client();

    return new Promise<{ success: boolean; message?: string; error?: string }>((resolve) => {
        conn.on('ready', () => {
            // Setup .ssh directory and append key
            const cmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "${pubKeyContent}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;

            conn.exec(cmd, (err, stream) => {
                if (err) {
                    conn.end();
                    resolve({ success: false, error: 'Failed to execute key installation: ' + err.message });
                    return;
                }

                stream.on('close', async (code: any, signal: any) => {
                    conn.end();
                    if (code !== 0) {
                        resolve({ success: false, error: `Key install command exited with code ${code}` });
                        return;
                    }

                    // 4. Add to Database (using the key path implicitly now)
                    // We don't store the key path in the DB if it's the default, or we store the custom one?
                    // `addLinuxHost` checks connection. It should succeed now using the key (assuming default key usage).

                    const res = await addLinuxHost({
                        name: params.hostname, // Use hostname as name initially
                        hostname: params.hostname,
                        port: params.port,
                        username: params.username,
                        ssh_key_path: params.publicKeyPath ? params.publicKeyPath.replace('.pub', '') : undefined,
                        description: params.description || 'Raised by Necromancer'
                    });

                    if (res.success) {
                        // Apply provisioning profile if specified
                        if (params.profileId && res.hostId) {
                            const profileResult = await applyProfile(res.hostId, params.profileId, 'linux');
                            if (profileResult.success) {
                                resolve({ success: true, message: `Server ${params.hostname} reanimated and profile applied successfully.` });
                            } else {
                                resolve({ success: true, message: `Server ${params.hostname} reanimated, but profile had issues: ${profileResult.error || 'Some steps failed'}` });
                            }
                        } else {
                            resolve({ success: true, message: `Server ${params.hostname} has been successfully reanimated and added to the fleet.` });
                        }
                    } else {
                        resolve({ success: false, error: 'Key installed but failed to add host: ' + res.error });
                    }
                });
            });

        }).on('error', (err) => {
            resolve({ success: false, error: 'SSH Connection Failed (Check password): ' + err.message });
        }).connect({
            host: params.hostname,
            port: params.port,
            username: params.username,
            password: params.rootPassword,
            readyTimeout: 10000
        });
    });
}
