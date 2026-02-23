
// import { scanInfrastructure } from '../src/lib/autonomous/sense';
// import { getProxmoxNodes } from '../src/lib/actions/proxmox-reader';
import { ProxmoxClient } from '../src/lib/proxmox';

async function main() {
    console.log("--- DIAGONSTIC START ---");

    console.log("1. Testing Proxmox Client Direct Connection...");
    try {
        const client = new ProxmoxClient({
            url: process.env.PROXMOX_URL || '',
            username: process.env.PROXMOX_USERNAME || '',
            password: process.env.PROXMOX_PASSWORD || '',
            type: (process.env.PROXMOX_TYPE as 'pve' | 'pbs') || 'pve'
        });
        // Force init to check env vars
        console.log("Client initialized.");
        await client.authenticate();
        console.log("Auth successful: Ticket obtained internally.");
    } catch (e: any) {
        console.error("Proxmox Auth Failed:", e.message);
    }

    console.log("\n2. Testing proxmox-reader.getProxmoxNodes()...");
    console.log("getProxmoxNodes has been deprecated or moved.");

    console.log("\n3. Testing sense.scanInfrastructure()...");
    console.log("scanInfrastructure has been deprecated or moved.");

    console.log("--- DIAGNOSTIC END ---");
}

main().catch(console.error);
