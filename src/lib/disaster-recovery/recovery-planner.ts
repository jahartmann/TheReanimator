/**
 * Recovery Planner
 * 
 * Generates a step-by-step recovery plan from backup analysis.
 * Groups steps by phase, handles dependencies, and includes
 * post-restore commands.
 */

import type { BackupAnalysis, AnalyzedFile } from './config-analyzer';
import type { Recommendation, ConfigCategory } from './proxmox-config-map';
import { getCategoryInfo, getRiskInfo } from './proxmox-config-map';

export type RecoveryScenario = 'cluster-rejoin' | 'standalone-restore' | 'disk-replacement' | 'full-rebuild';

export interface RecoveryStep {
    id: string;
    /** File being restored */
    file: AnalyzedFile;
    /** Phase this step belongs to */
    phase: RecoveryPhase;
    /** What action to take */
    action: Recommendation;
    /** Whether this step has been completed */
    completed: boolean;
    /** Whether this step was skipped by the user */
    skipped: boolean;
    /** Post-restore command to run, if any */
    postCommand?: string;
    /** Dependencies: step IDs that must complete first */
    dependsOn: string[];
}

export interface RecoveryPhase {
    id: string;
    name: { de: string; en: string };
    description: { de: string; en: string };
    icon: string;
    order: number;
    steps: RecoveryStep[];
}

export interface PostRestoreAction {
    command: string;
    description: { de: string; en: string };
    /** When to run this (after which phase) */
    afterPhase: string;
    /** Whether this is required or optional */
    required: boolean;
}

export interface RecoveryPlan {
    /** Detected scenario */
    scenario: RecoveryScenario;
    /** Scenario description */
    scenarioDescription: { de: string; en: string };
    /** Recovery phases in order */
    phases: RecoveryPhase[];
    /** Post-restore actions */
    postActions: PostRestoreAction[];
    /** Summary stats */
    stats: {
        totalFiles: number;
        toRestore: number;
        toMerge: number;
        toSkip: number;
        toCompare: number;
    };
}

/**
 * Detect the recovery scenario based on backup analysis
 */
function detectScenario(analysis: BackupAnalysis, hasDiskChanges: boolean): RecoveryScenario {
    if (analysis.isCluster && hasDiskChanges) return 'disk-replacement';
    if (analysis.isCluster) return 'cluster-rejoin';
    if (hasDiskChanges) return 'full-rebuild';
    return 'standalone-restore';
}

const SCENARIO_DESCRIPTIONS: Record<RecoveryScenario, { de: string; en: string }> = {
    'cluster-rejoin': {
        de: 'Cluster-Wiederherstellung: Die Node ist bereits Mitglied im Cluster und soll nahtlos wieder als dieselbe Node erscheinen — als wäre nichts passiert. Cluster-synchronisierte Dateien (/etc/pve) werden via pmxcfs automatisch vom Cluster synchronisiert, sobald die Node wieder online ist. Lokale Dateien (Netzwerk, fstab, SSH) müssen korrekt sein.',
        en: 'Cluster recovery: The node is already a cluster member and should seamlessly reappear as the same node — as if nothing happened. Cluster-synced files (/etc/pve) sync automatically via pmxcfs once the node comes back online. Local files (network, fstab, SSH) must be correct.'
    },
    'standalone-restore': {
        de: 'Standalone-Restore: Einzelne Node (kein Cluster) wird wiederhergestellt. Alle Dateien müssen manuell restored werden.',
        en: 'Standalone restore: Single node (no cluster) being restored. All files must be manually restored.'
    },
    'disk-replacement': {
        de: 'Disk-Tausch im Cluster: Festplatten wurden getauscht, UUIDs haben sich geändert. Die Node soll als dieselbe Node zurückkehren. fstab und Storage-Configs brauchen UUID-Mapping.',
        en: 'Disk replacement in cluster: Disks replaced, UUIDs changed. Node should return as the same node. fstab and storage configs need UUID mapping.'
    },
    'full-rebuild': {
        de: 'Vollständiger Neuaufbau: Node wird komplett neu aufgesetzt. Alle Configs müssen sorgfältig gemerged werden.',
        en: 'Full rebuild: Node being completely rebuilt. All configs must be carefully merged.'
    },
};

/**
 * Generate a recovery plan from backup analysis
 */
export function generateRecoveryPlan(
    analysis: BackupAnalysis,
    hasDiskChanges: boolean = false
): RecoveryPlan {
    const scenario = detectScenario(analysis, hasDiskChanges);

    // Define phases
    const phases: RecoveryPhase[] = [
        {
            id: 'identity',
            name: { de: '1. Node-Identität', en: '1. Node Identity' },
            description: {
                de: 'Hostname und DNS-Auflösung — die Grundlage für Cluster-Erkennung.',
                en: 'Hostname and DNS resolution — the foundation for cluster recognition.'
            },
            icon: '🏷️',
            order: 1,
            steps: [],
        },
        {
            id: 'network',
            name: { de: '2. Netzwerk', en: '2. Network' },
            description: {
                de: 'Netzwerk-Interfaces, Bridges und DNS-Server. Ohne Netzwerk ist nichts möglich.',
                en: 'Network interfaces, bridges, and DNS servers. Without network, nothing works.'
            },
            icon: '🌐',
            order: 2,
            steps: [],
        },
        {
            id: 'storage',
            name: { de: '3. Speicher & Mountpoints', en: '3. Storage & Mountpoints' },
            description: {
                de: 'fstab, Storage-Definitionen. Bei Disk-Tausch: UUID-Mapping erforderlich!',
                en: 'fstab, storage definitions. With disk replacement: UUID mapping required!'
            },
            icon: '💾',
            order: 3,
            steps: [],
        },
        {
            id: 'access',
            name: { de: '4. Zugang & SSH', en: '4. Access & SSH' },
            description: {
                de: 'SSH-Keys und Authentifizierung. Damit Reanimator wieder Zugriff hat.',
                en: 'SSH keys and authentication. So Reanimator has access again.'
            },
            icon: '🔑',
            order: 4,
            steps: [],
        },
        {
            id: 'cluster',
            name: { de: '5. Cluster & Auth', en: '5. Cluster & Auth' },
            description: {
                de: 'Cluster-Konfiguration und Proxmox-Authentifizierung. Die meisten Dateien werden automatisch synchronisiert!',
                en: 'Cluster configuration and Proxmox authentication. Most files sync automatically!'
            },
            icon: '🔗',
            order: 5,
            steps: [],
        },
        {
            id: 'vms',
            name: { de: '6. VMs & Container', en: '6. VMs & Containers' },
            description: {
                de: 'VM- und Container-Konfigurationen. Im Cluster automatisch synchronisiert.',
                en: 'VM and container configurations. Auto-synced in cluster mode.'
            },
            icon: '🖥️',
            order: 6,
            steps: [],
        },
        {
            id: 'system',
            name: { de: '7. System & Cron', en: '7. System & Cron' },
            description: {
                de: 'APT-Repos, Cron-Jobs und sonstige Systemkonfiguration.',
                en: 'APT repos, cron jobs, and other system configuration.'
            },
            icon: '⚙️',
            order: 7,
            steps: [],
        },
    ];

    // Phase mapping by category and path
    function getPhaseForFile(file: AnalyzedFile): string {
        const path = file.relativePath;
        if (path.includes('hostname')) return 'identity';
        if (path.includes('etc/hosts')) return 'identity';
        if (path.includes('network/interfaces')) return 'network';
        if (path.includes('resolv.conf')) return 'network';
        if (path.includes('fstab')) return 'storage';
        if (path.includes('storage.cfg')) return 'storage';
        if (path.includes('.ssh/')) return 'access';
        if (path.includes('pve/corosync') || path.includes('pve/authkey') ||
            path.includes('pve-www.key') || path.includes('pve-root-ca') ||
            path.includes('pve-ssl') || path.includes('pve/user.cfg') ||
            path.includes('pve/priv/') || path.includes('pve/datacenter')) return 'cluster';
        if (path.includes('qemu-server') || path.includes('/lxc/')) return 'vms';
        if (path.includes('firewall')) return 'cluster';
        return 'system';
    }

    // Build steps
    const allFiles: AnalyzedFile[] = [];
    for (const cat of analysis.categories) {
        allFiles.push(...cat.files);
    }

    // Sort by restore order
    allFiles.sort((a, b) => (a.configInfo?.restoreOrder ?? 999) - (b.configInfo?.restoreOrder ?? 999));

    const stats = { totalFiles: 0, toRestore: 0, toMerge: 0, toSkip: 0, toCompare: 0 };

    for (const file of allFiles) {
        const phaseId = getPhaseForFile(file);
        const phase = phases.find(p => p.id === phaseId)!;

        stats.totalFiles++;
        switch (file.recommendation) {
            case 'restore': stats.toRestore++; break;
            case 'merge': stats.toMerge++; break;
            case 'skip': stats.toSkip++; break;
            case 'compare-first': stats.toCompare++; break;
        }

        const step: RecoveryStep = {
            id: `step-${file.relativePath.replace(/[^a-z0-9]/gi, '-')}`,
            file,
            phase,
            action: file.recommendation,
            completed: false,
            skipped: file.recommendation === 'skip',
            dependsOn: [],
        };

        // Add post-commands for specific files
        if (file.relativePath.includes('network/interfaces')) {
            step.postCommand = 'ifreload -a || systemctl restart networking';
        } else if (file.relativePath.includes('hostname')) {
            step.postCommand = 'hostname $(cat /etc/hostname)';
        }

        phase.steps.push(step);
    }

    // Build post-restore actions
    const postActions: PostRestoreAction[] = [];

    if (scenario === 'cluster-rejoin') {
        postActions.push({
            command: 'pvecm add <CLUSTER_IP> --force',
            description: {
                de: 'Node wieder dem Cluster hinzufügen. Ersetze <CLUSTER_IP> durch die IP einer laufenden Cluster-Node.',
                en: 'Rejoin node to cluster. Replace <CLUSTER_IP> with IP of a running cluster node.'
            },
            afterPhase: 'access',
            required: true,
        });
        postActions.push({
            command: 'pvecm updatecerts --force',
            description: {
                de: 'Cluster-Zertifikate aktualisieren. Muss auf ALLEN Nodes ausgeführt werden.',
                en: 'Update cluster certificates. Must be run on ALL nodes.'
            },
            afterPhase: 'cluster',
            required: true,
        });
    }

    postActions.push({
        command: 'systemctl restart pvedaemon pveproxy pvestatd',
        description: {
            de: 'Proxmox-Dienste neustarten um Änderungen zu übernehmen.',
            en: 'Restart Proxmox services to apply changes.'
        },
        afterPhase: 'cluster',
        required: true,
    });

    if (scenario === 'cluster-rejoin' || scenario === 'disk-replacement') {
        postActions.push({
            command: 'pvecm status',
            description: {
                de: 'Cluster-Status prüfen — Node sollte als "Online" erscheinen.',
                en: 'Check cluster status — node should appear as "Online".'
            },
            afterPhase: 'cluster',
            required: false,
        });
    }

    // Filter out empty phases
    const activePhases = phases.filter(p => p.steps.length > 0);

    return {
        scenario,
        scenarioDescription: SCENARIO_DESCRIPTIONS[scenario],
        phases: activePhases,
        postActions,
        stats,
    };
}
