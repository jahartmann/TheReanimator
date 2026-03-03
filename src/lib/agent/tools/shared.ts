import db from '@/lib/db';
import { getVMs } from '@/lib/actions/vm';
import { withSSH } from '@/lib/ssh-pool';

// BLOCKED commands - these require explicit confirmation
export const BLOCKED_COMMANDS = [
    'reboot', 'shutdown', 'poweroff', 'halt', 'init', 'telinit',
    'rm -rf', 'rm -r', 'rmdir', // destructive deletes
    'dd ', 'mkfs', 'fdisk', 'parted', 'sfdisk', 'wipefs', // disk operations
    ':(){:|:&};:', // fork bomb
];

// SAFE commands - these can run autonomously without confirmation
export const SAFE_COMMAND_PATTERNS = [
    // System info
    /^(df|free|top|htop|uptime|uname|lsb_release|cat|less|head|tail|grep|awk|sed)/,
    /^(ps|pgrep|pstree|lsof|netstat|ss|ip|ifconfig|route|arp)/,
    // Logs & Diagnostics
    /^(journalctl|dmesg|last|who|w|vmstat|iostat|mpstat|sar)/,
    // Proxmox specific - READ operations
    /^(qm (config|status|list|showcmd|guest|agent))/,
    /^(pct (config|status|list|exec))/,
    /^(pvecm (status|nodes|expected))/,
    /^(pvesh get)/,
    /^(pveversion|proxmox-backup-client status)/,
    // ZFS - READ operations
    /^(zpool (status|list|iostat|history))/,
    /^(zfs (list|get))/,
    // Package management - INFO only
    /^(apt (list|search|show|policy)|apt-cache|dpkg (-l|-L|-s|--list))/,
    // Service status - READ only
    /^(systemctl (status|is-active|is-enabled|list-units|list-timers))/,
    // Network diagnostics
    /^(ping|traceroute|tracepath|nslookup|dig|host|mtr|curl -I|wget --spider)/,
    // File info (not modification)
    /^(ls|find|locate|which|whereis|file|stat|du|wc)/,
    // Hardware info
    /^(lspci|lsusb|lsblk|lscpu|lsmem|dmidecode|smartctl)/,
];

export function isCommandSafe(cmd: string): boolean {
    const lower = cmd.toLowerCase().trim();

    // Always block dangerous patterns
    if (lower.includes('> /dev/')) return false;
    if (lower.includes(':(){:|:&};:')) return false;
    if (lower.includes('| sh') || lower.includes('| bash')) return false;
    if (lower.includes('$(') || lower.includes('`')) return false;

    // Check explicit blocked list
    if (BLOCKED_COMMANDS.some(blocked => lower.includes(blocked))) {
        return false;
    }

    // Check if matches safe patterns
    for (const pattern of SAFE_COMMAND_PATTERNS) {
        if (pattern.test(cmd)) {
            return true;
        }
    }

    // Default: allow if no blocked pattern matched and seems like a read operation
    const seemsSafe = !lower.includes('rm ') &&
        !lower.includes('mv ') &&
        !lower.includes('cp ') &&
        !lower.includes('chmod') &&
        !lower.includes('chown') &&
        !lower.includes('kill') &&
        !lower.includes('pkill');

    return seemsSafe;
}

/** Human-readable cron description */
export function describeCron(cron: string): string {
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5) return cron;
    const [min, hour, dom, mon, dow] = parts;

    const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

    let desc = '';

    if (min.startsWith('*/')) desc = `Alle ${min.slice(2)} Minuten`;
    else if (hour.startsWith('*/')) desc = `Alle ${hour.slice(2)} Stunden um :${min.padStart(2, '0')}`;
    else if (dom === '*' && mon === '*' && dow === '*') desc = `Täglich um ${hour}:${min.padStart(2, '0')} Uhr`;
    else if (dom === '*' && mon === '*' && dow !== '*') {
        const dayIdx = parseInt(dow);
        const dayName = dayNames[dayIdx] || dow;
        desc = `Jeden ${dayName} um ${hour}:${min.padStart(2, '0')} Uhr`;
    } else if (dom !== '*') desc = `Am ${dom}. jeden Monats um ${hour}:${min.padStart(2, '0')} Uhr`;
    else desc = `${cron}`;

    return desc;
}

// Helper: Get server by ID or name
export function getServerByIdOrName(identifier: number | string): any {
    if (typeof identifier === 'number') {
        return db.prepare('SELECT * FROM servers WHERE id = ?').get(identifier);
    }
    return db.prepare('SELECT * FROM servers WHERE name LIKE ?').get(`%${identifier}%`);
}

// Helper: Find VM across all servers (DB-first, then parallel SSH fallback)
export async function findVM(vmid: number): Promise<{ vm: any, server: any } | null> {
    // 1. DB-first lookup (fast, no SSH needed)
    try {
        const row = db.prepare(`
            SELECT v.*, s.id as server_id, s.name as server_name, s.ssh_host, s.ssh_port, s.ssh_user, s.ssh_key, s.url, s.type as server_type, s.auth_token
            FROM vms v JOIN servers s ON v.server_id = s.id
            WHERE v.vmid = ?
        `).get(vmid) as any;
        if (row) {
            const server = {
                id: row.server_id, name: row.server_name,
                ssh_host: row.ssh_host, ssh_port: row.ssh_port,
                ssh_user: row.ssh_user, ssh_key: row.ssh_key,
                url: row.url, type: row.server_type, auth_token: row.auth_token,
            };
            return { vm: row, server };
        }
    } catch { /* vms table may not exist or be stale */ }

    // 2. Parallel SSH fallback
    const servers = db.prepare('SELECT * FROM servers').all() as any[];
    const results = await Promise.allSettled(
        servers.map(async (server) => {
            const vms = await getVMs(server.id);
            const vm = vms.find((v: any) => parseInt(v.vmid) === vmid);
            if (vm) return { vm, server };
            return null;
        })
    );

    for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
            return result.value;
        }
    }
    return null;
}

// Helper: Get current VM status (uses SSH pool)
export async function getVMStatus(server: any, vmid: number, type: 'qemu' | 'lxc'): Promise<string> {
    try {
        return await withSSH(server, async (ssh) => {
            const cmd = type === 'lxc' ? `pct status ${vmid}` : `qm status ${vmid}`;
            const output = await ssh.exec(cmd);
            const match = output.match(/status:\s*(\w+)/i);
            return match ? match[1].toLowerCase() : 'unknown';
        });
    } catch (e) {
        return 'error';
    }
}
