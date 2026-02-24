'use server'

import { ProxmoxClient } from '@/lib/proxmox';

export async function generateApiToken(url: string, user: string, pass: string, type: 'pve' | 'pbs') {
    console.log(`Attempting to generate token for ${user} at ${url}...`);

    try {
        // 1. Initialize Client with User/Pass
        const client = new ProxmoxClient({
            url,
            username: user,
            password: pass,
            type
        });

        // 2. Generate Token
        // We append a random suffix to avoid collision if multiple apps use this
        const tokenName = `proxhost-${Math.floor(Math.random() * 1000)}`;
        const fullToken = await client.generateToken(tokenName);

        return { success: true, token: fullToken };
    } catch (error) {
        console.error("Generate Token Action Failed:", error);
        return { success: false, message: String(error) };
    }
}
