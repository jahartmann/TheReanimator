'use server'

import { ProxmoxClient } from '@/lib/proxmox';
import { getCurrentUser } from '@/lib/actions/userAuth';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

export async function testConnection(url: string, token: string, type: 'pve' | 'pbs') {
    const user = await getCurrentUser();
    if (!user) return { success: false, message: 'Unauthorized' };

    console.log(`Testing connection to ${url} (${type})...`);

    try {
        const client = new ProxmoxClient({
            url,
            token,
            type
        });

        const success = await client.checkStatus();
        if (success) {
            return { success: true, message: 'Connection successful!' };
        } else {
            return { success: false, message: 'Could not connect. Check URL/Token.' };
        }
    } catch (error) {
        return { success: false, message: String(error) };
    }
}

export async function systemRestart() {
    const user = await getCurrentUser();
    if (!user?.is_admin) return { success: false, message: 'Unauthorized' };

    console.log('Triggering system restart...');
    try {
        const { stdout, stderr } = await execAsync('./manage.sh restart');
        console.log('Restart script output:', stdout);
        if (stderr) console.error('Restart script error output:', stderr);
        return { success: true, message: `Restart initiated.\n${stdout}` };
    } catch (e) {
        console.error(e);
        return { success: false, message: 'Failed to restart: ' + String(e) };
    }
}

export async function systemUpdate() {
    const user = await getCurrentUser();
    if (!user?.is_admin) return { success: false, message: 'Unauthorized' };

    // This is risky to run from the web app itself as it kills the process running the app
    // Ideally this writes a trigger file or similar.
    // For now, we'll invoke the management script which provides detailed logging.
    try {
        const { stdout, stderr } = await execAsync('./manage.sh update');
        console.log('Update script output:', stdout);
        if (stderr) console.error('Update script error output:', stderr);
        // The script will handle restart; we just return the output.
        return { success: true, message: `Update process started.\n${stdout}` };
    } catch (e) {
        console.error(e);
        return { success: false, message: 'Update failed: ' + String(e) };
    }
}
