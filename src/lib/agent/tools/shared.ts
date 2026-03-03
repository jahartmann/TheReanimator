import db from '@/lib/db';
import { getVMs } from '@/lib/actions/vm';
import { withSSH } from '@/lib/ssh-pool';

/** Escape a string for safe use as a shell argument (single-quote wrapping). */
export function shellEscape(arg: string): string {
    return "'" + arg.replace(/'/g, "'\\''") + "'";
}

// BLOCKED commands - these require explicit confirmation
export const BLOCKED_COMMANDS = [
    'reboot', 'shutdown', 'poweroff', 'halt', 'init', 'telinit',
    'rm -rf', 'rm -r', 'rmdir', // destructive deletes
    'dd ', 'mkfs', 'fdisk', 'parted', 'sfdisk', 'wipefs', // disk operations
    ':(){:|:&};:', // fork bomb
    'curl.*|', 'wget.*|', 'curl.*bash', 'wget.*sh', // pipe to shell
    'python', 'python3', 'perl', 'ruby', // script execution
    'nc ', 'ncat ', 'netcat', // network tools
    'eval ', 'exec ', // code execution
    '>(', '<(', // process substitution
    '`', // backtick command substitution
];

// SAFE command prefixes - whitelist approach (deny by default)
export const SAFE_COMMAND_PREFIXES = [
    'cat', 'ls', 'df', 'du', 'free', 'uptime', 'uname', 'hostname',
    'whoami', 'date', 'ps', 'top', 'htop', 'systemctl status',
    'journalctl', 'ip', 'ss', 'netstat', 'lsblk', 'lscpu', 'lsof',
    'mount', 'findmnt', 'head', 'tail', 'wc', 'grep', 'find',
    'stat', 'file', 'which', 'dpkg -l', 'apt list',
    'qm list', 'qm status', 'qm config',
    'pct list', 'pct status', 'pct config',
    'pvesm', 'pvecm', 'pveversion',
    // Additional read-only commands
    'lsb_release', 'less', 'pgrep', 'pstree', 'ifconfig', 'route', 'arp',
    'dmesg', 'last', 'who', 'w', 'vmstat', 'iostat', 'mpstat', 'sar',
    'pvesh get', 'proxmox-backup-client status',
    'zpool status', 'zpool list', 'zpool iostat', 'zpool history',
    'zfs list', 'zfs get',
    'apt search', 'apt show', 'apt policy', 'apt-cache', 'dpkg -L', 'dpkg -s', 'dpkg --list',
    'systemctl is-active', 'systemctl is-enabled', 'systemctl list-units', 'systemctl list-timers',
    'ping', 'traceroute', 'tracepath', 'nslookup', 'dig', 'host', 'mtr',
    'locate', 'whereis', 'lspci', 'lsusb', 'lsmem', 'dmidecode', 'smartctl',
    'qm showcmd', 'qm guest', 'qm agent',
    'pct exec',
    'pvecm status', 'pvecm nodes', 'pvecm expected',
];

export function isCommandSafe(cmd: string): boolean {
    const trimmed = cmd.trim();
    const lower = trimmed.toLowerCase();

    // Always block dangerous patterns
    if (lower.includes('> /dev/')) return false;
    if (lower.includes(':(){:|:&};:')) return false;
    if (lower.includes('| sh') || lower.includes('| bash')) return false;
    if (lower.includes('$(') || lower.includes('`')) return false;
    if (lower.includes('>(') || lower.includes('<(')) return false;
    if (lower.includes('curl') && (lower.includes('| ') || lower.includes('bash'))) return false;
    if (lower.includes('wget') && (lower.includes('| ') || lower.includes('| sh'))) return false;

    // Check explicit blocked list
    if (BLOCKED_COMMANDS.some(blocked => lower.includes(blocked))) {
        return false;
    }

    // Whitelist approach: only allow commands that start with a known safe prefix
    for (const prefix of SAFE_COMMAND_PREFIXES) {
        if (lower === prefix || lower.startsWith(prefix + ' ') || lower.startsWith(prefix + '\t')) {
            return true;
        }
    }

    // Default: DENY if not explicitly whitelisted
    return false;
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
