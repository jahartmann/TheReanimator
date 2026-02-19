import db from '@/lib/db';
import { getProxmoxNodes, getProxmoxVMs } from '@/lib/actions/proxmox-reader';
import { getLinuxHosts } from '@/lib/actions/linux';
import { logAutonomousEvent } from '@/lib/autonomous/db';

export async function scanInfrastructure() {
    try {
        const runId = crypto.randomUUID();

        // 1. Scan Proxmox
        const nodes = await getProxmoxNodes() || [];
        const vms = await getProxmoxVMs() || [];

        // 2. Scan Linux Servers
        const servers = await getLinuxHosts() || [];

        // 3. Log the "Sensation"
        // In a real system, we would diff this against previous state.
        // For now, we just log that we saw them.

        const summary = `Scanned ${nodes.length} Nodes, ${vms.length} VMs, ${servers.length} Servers`;

        // Detailed analysis (simplified "Brain" function)
        const offlineVMs = vms.filter(v => v.status !== 'running');

        let details = `Online VMs: ${vms.length - offlineVMs.length}. Offline: ${offlineVMs.length}.`;
        if (offlineVMs.length > 0) {
            details += `\nOffline: ${offlineVMs.map(v => v.name).join(', ')}`;
        }

        await logAutonomousEvent({
            run_id: runId,
            event_type: 'thought',
            summary: summary,
            details: details,
            status: 'success'
        });

        // Save detailed snapshot (Future: dedicated table)
        // For now, allow other organs to react to this data if needed.

        return {
            runId,
            nodes,
            vms,
            servers
        };

    } catch (error: any) {
        console.error("Infrastructure Scan Failed:", error);
        await logAutonomousEvent({
            run_id: 'error',
            event_type: 'thought',
            summary: 'Failed to scan infrastructure',
            details: error.message,
            status: 'failure'
        });
        return null;
    }
}

export interface SystemSnapshot {
    runId: string;
    nodes: import('@/lib/proxmox').NodeInfo[];
    vms: import('@/lib/proxmox').VMInfo[];
    servers: import('@/lib/actions/linux').LinuxHost[];
}
