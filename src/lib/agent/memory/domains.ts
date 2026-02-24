/**
 * Domain management and automatic classification for brain entries.
 */

export const BRAIN_DOMAINS = {
    troubleshooting: {
        label: 'Troubleshooting',
        description: 'Problemlösungen und Debugging',
        keywords: ['error', 'fehler', 'problem', 'fix', 'bug', 'crash', 'fail', 'broken', 'issue', 'debug'],
    },
    howto: {
        label: 'How-To',
        description: 'Anleitungen und Guides',
        keywords: ['howto', 'guide', 'anleitung', 'setup', 'install', 'configure', 'tutorial', 'steps'],
    },
    config: {
        label: 'Konfiguration',
        description: 'Server-Konfigurationen und Einstellungen',
        keywords: ['config', 'setting', 'parameter', 'option', 'konfiguration', 'einstellung'],
    },
    infrastructure: {
        label: 'Infrastruktur',
        description: 'Server, Netzwerk, Storage Informationen',
        keywords: ['server', 'network', 'storage', 'cluster', 'node', 'vm', 'container', 'proxmox'],
    },
    security: {
        label: 'Sicherheit',
        description: 'Sicherheitsrelevante Erkenntnisse',
        keywords: ['security', 'firewall', 'ssl', 'cert', 'auth', 'permission', 'vulnerability', 'sicherheit'],
    },
    performance: {
        label: 'Performance',
        description: 'Performance-Optimierungen und Benchmarks',
        keywords: ['performance', 'slow', 'fast', 'optimize', 'bottleneck', 'latency', 'throughput', 'cpu', 'ram'],
    },
    backup: {
        label: 'Backup',
        description: 'Backup-Strategien und Recovery',
        keywords: ['backup', 'restore', 'recovery', 'snapshot', 'replicate', 'sicherung'],
    },
    notes: {
        label: 'Notizen',
        description: 'Allgemeine Notizen und Beobachtungen',
        keywords: ['note', 'notiz', 'memo', 'observation', 'beobachtung'],
    },
    operations: {
        label: 'Betrieb',
        description: 'Tagesberichte, Job-Ergebnisse, Betriebsdaten',
        keywords: ['tagesbericht', 'daily', 'report', 'job', 'operation', 'betrieb', 'digest', 'zusammenfassung'],
    },
} as const;

export type BrainDomain = keyof typeof BRAIN_DOMAINS;

/**
 * Classify content into a domain based on key and content analysis.
 */
export function classifyDomain(key: string, content: string): BrainDomain {
    const text = `${key} ${content}`.toLowerCase();

    // Check key prefix first (explicit categorization)
    for (const [domain, config] of Object.entries(BRAIN_DOMAINS)) {
        if (key.toLowerCase().startsWith(domain + '_') || key.toLowerCase().startsWith(domain)) {
            return domain as BrainDomain;
        }
    }

    // Score-based classification
    let bestDomain: BrainDomain = 'notes';
    let bestScore = 0;

    for (const [domain, config] of Object.entries(BRAIN_DOMAINS)) {
        let score = 0;
        for (const keyword of config.keywords) {
            const regex = new RegExp(keyword, 'gi');
            const matches = text.match(regex);
            if (matches) score += matches.length;
        }
        if (score > bestScore) {
            bestScore = score;
            bestDomain = domain as BrainDomain;
        }
    }

    return bestDomain;
}

/**
 * Extract tags from content using keyword analysis.
 */
export function extractTags(content: string): string[] {
    const tags = new Set<string>();
    const text = content.toLowerCase();

    // Technology tags
    const techPatterns: Record<string, RegExp> = {
        'proxmox': /proxmox|pve|pvecm/i,
        'zfs': /zfs|zpool/i,
        'lxc': /lxc|container|pct/i,
        'qemu': /qemu|kvm|qm\s/i,
        'docker': /docker|compose/i,
        'networking': /vlan|bridge|vmbr|firewall|iptables|nftables/i,
        'storage': /ceph|nfs|iscsi|lvm|storage/i,
        'backup': /backup|snapshot|vzdump|restore/i,
        'ssl': /ssl|tls|cert|certificate/i,
        'systemd': /systemd|systemctl|service/i,
        'debian': /debian|apt|dpkg/i,
        'pbs': /pbs|proxmox.backup/i,
    };

    for (const [tag, pattern] of Object.entries(techPatterns)) {
        if (pattern.test(text)) tags.add(tag);
    }

    return Array.from(tags);
}
