'use server';

import { headers, cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { createSSHClient } from '@/lib/ssh';
import { Server } from './server';

// Helper function to get locale from request
async function getServerLocale(): Promise<string> {
    const headersList = await headers();
    const cookieStore = await cookies();

    // Try to get locale from cookie first
    const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value;
    if (cookieLocale && routing.locales.includes(cookieLocale as any)) {
        return cookieLocale;
    }

    // Try to get from Accept-Language header
    const acceptLanguage = headersList.get('accept-language');
    if (acceptLanguage) {
        const preferredLocale = acceptLanguage.split(',')[0].split('-')[0];
        if (routing.locales.includes(preferredLocale as any)) {
            return preferredLocale;
        }
    }

    // Fallback to default locale
    return routing.defaultLocale;
}

export interface NetworkInterface {
    name: string;
    ip: string;
    mac: string;
    state: string;
    type: string;
    speed?: string;
    bridge?: string;
    slaves?: string[];
}

export interface DiskInfo {
    name: string;
    size: string;
    type: string;
    mountpoint: string;
    model?: string;
    serial?: string;
    filesystem?: string;
    rotational?: boolean;
    transport?: string;
}

export interface StoragePool {
    name: string;
    type: string;
    size: string;
    used: string;
    free: string;
    available?: string;
    capacity: number;
    health?: string;
}

export interface SystemInfo {
    hostname: string;
    os: string;
    kernel: string;
    uptime: string;
    cpu: string;
    cpuCores: number;
    cpuUsage: number;
    memory: string;
    memoryTotal: number;
    memoryUsed: number;
    memoryUsage: number;
    loadAvg: string;
}

function formatBytesSimple(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function formatUptime(uptime: string): Promise<string> {
    if (!uptime || uptime === 'Unknown' || uptime === '-') {
        return uptime;
    }

    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'actionsMonitoring' });

    // Parse "up X weeks, Y days, Z hours, W minutes" format from uptime -p
    let translated = uptime
        .replace(/^up\s*/, '')
        .replace(/weeks?/, ` ${t('week')} `)
        .replace(/days?/, ` ${t('day')} `)
        .replace(/hours?/, ` ${t('hour')} `)
        .replace(/minutes?/, ` ${t('minute')} `)
        .replace(/,\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return translated || uptime;
}

async function formatMemoryString(memory: string): Promise<string> {
    if (!memory || memory === '-') {
        return memory;
    }

    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'actionsMonitoring' });

    // Parse "251Gi total, 155Gi used" format from free -h
    const translated = memory
        .replace(/total/, ` ${t('total')}`)
        .replace(/used/, ` ${t('used')}`)
        .replace(/,/g, ',');

    return translated || memory;
}

async function getSystemStats(ssh: any) {
    try {
        const [
            hostname,
            osRelease,
            kernel,
            uptime,
            cpuInfo,
            cpuCoresOutput,
            loadAvg,
            cpuUsageOutput,
            memInfoOutput,
            memReadable
        ] = await Promise.all([
            ssh.exec('hostname', 5000).then((o: string) => o.trim()).catch(() => 'Unknown'),
            ssh.exec('cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \\"', 5000).catch(() => 'Unknown'),
            ssh.exec('uname -r', 5000).then((o: string) => o.trim()).catch(() => 'Unknown'),
            ssh.exec('uptime -p', 5000).then((o: string) => o.trim()).catch(() => 'Unknown'),
            ssh.exec('grep "model name" /proc/cpuinfo | head -1 | cut -d: -f2', 5000).then((o: string) => o.trim()).catch(() => 'Unknown'),
            ssh.exec('nproc 2>/dev/null || grep -c processor /proc/cpuinfo', 5000).then((o: string) => o.trim()).catch(() => '1'),
            ssh.exec('cat /proc/loadavg | cut -d" " -f1-3', 5000).then((o: string) => o.trim()).catch(() => '0.00 0.00 0.00'),
            ssh.exec(`top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1 2>/dev/null || echo "0"`, 5000).catch(() => '0'),
            ssh.exec(`free -b | grep Mem | awk '{print $2, $3}'`, 5000).catch(() => '0 0'),
            ssh.exec('free -h | grep Mem | awk \'{print $2 " total, " $3 " used"}\'', 5000).then((o: string) => o.trim()).catch(() => '-')
        ]);

        const cpuCores = parseInt(cpuCoresOutput) || 1;
        const cpuUsage = parseFloat(cpuUsageOutput.trim()) || 0;

        const memParts = memInfoOutput.trim().split(/\s+/);
        const memoryTotal = parseInt(memParts[0]) || 0;
        const memoryUsed = parseInt(memParts[1]) || 0;
        const memoryUsage = memoryTotal > 0 ? (memoryUsed / memoryTotal) * 100 : 0;

        return {
            hostname,
            os: osRelease.trim(),
            kernel,
            uptime: await formatUptime(uptime),
            cpu: cpuInfo,
            cpuCores,
            cpuUsage,
            memory: await formatMemoryString(memReadable),
            memoryTotal,
            memoryUsed,
            memoryUsage,
            loadAvg
        };
    } catch (e) {
        console.error('Failed to fetch system stats:', e);
        return {
            hostname: 'Error',
            os: 'Unknown',
            kernel: 'Unknown',
            uptime: '-',
            cpu: 'Unknown',
            cpuCores: 1,
            cpuUsage: 0,
            memory: '-',
            memoryTotal: 0,
            memoryUsed: 0,
            memoryUsage: 0,
            loadAvg: '-'
        };
    }
}

async function getNetworkStats(ssh: any, debug: string[]) {
    try {
        const cmd = `/usr/sbin/ip -j addr 2>&1 || /bin/ip -j addr 2>&1 || ip -j addr 2>&1`;
        debug.push(`[Network] Running: ${cmd}`);
        const netOutput = await ssh.exec(cmd, 30000);
        debug.push(`[Network] Output (first 100 chars): ${netOutput.substring(0, 100)}...`);

        let networks: NetworkInterface[] = [];

        try {
            const netJson = JSON.parse(netOutput);
            networks = netJson
                .filter((iface: any) => iface.ifname !== 'lo')
                .map((iface: any) => ({
                    name: iface.ifname,
                    ip: iface.addr_info?.find((a: any) => a.family === 'inet')?.local || '-',
                    mac: iface.address || '-',
                    state: iface.operstate || 'unknown',
                    type: iface.link_type || 'unknown',
                    speed: '',
                    bridge: '',
                    slaves: []
                }));
        } catch {
            // Fallback parsing
            const lines = netOutput.split('\n');
            let current: Partial<NetworkInterface> = {};
            for (const line of lines) {
                if (line.match(/^\d+:/)) {
                    if (current.name && current.name !== 'lo') {
                        networks.push(current as NetworkInterface);
                    }
                    const match = line.match(/^\d+:\s+(\S+):/);
                    current = {
                        name: match?.[1] || '',
                        ip: '-',
                        mac: '-',
                        state: line.includes('UP') ? 'UP' : 'DOWN',
                        type: 'physical'
                    };
                }
                if (line.includes('link/ether')) {
                    const mac = line.match(/link\/ether\s+(\S+)/)?.[1];
                    if (mac) current.mac = mac;
                }
                if (line.includes('inet ') && !line.includes('inet6')) {
                    const ip = line.match(/inet\s+(\S+)/)?.[1]?.split('/')[0];
                    if (ip) current.ip = ip;
                }
            }
            if (current.name && current.name !== 'lo') {
                networks.push(current as NetworkInterface);
            }
        }

        // Enrich networks in parallel
        await Promise.all(networks.map(async (net) => {
            try {
                // We use Promise.allSettled here to avoid one interface check blocking others
                const [brOutput, bondOutput, speedOutput, masterOutput] = await Promise.all([
                    ssh.exec(`ls /sys/class/net/${net.name}/brif 2>/dev/null || echo ""`, 5000).catch(() => ''),
                    ssh.exec(`cat /sys/class/net/${net.name}/bonding/slaves 2>/dev/null || echo ""`, 5000).catch(() => ''),
                    ssh.exec(`cat /sys/class/net/${net.name}/speed 2>/dev/null || echo ""`, 5000).catch(() => ''),
                    ssh.exec(`cat /sys/class/net/${net.name}/master/uevent 2>/dev/null | grep INTERFACE | cut -d= -f2 || echo ""`, 5000).catch(() => '')
                ]);

                if (brOutput.trim()) {
                    net.type = 'bridge';
                    net.slaves = brOutput.trim().split('\n').filter(Boolean);
                }

                if (bondOutput.trim()) {
                    net.type = 'bond';
                    net.slaves = bondOutput.trim().split(' ').filter(Boolean);
                }

                if (speedOutput.trim() && !isNaN(parseInt(speedOutput.trim()))) {
                    const speed = parseInt(speedOutput.trim());
                    net.speed = speed >= 1000 ? `${speed / 1000}Gbps` : `${speed}Mbps`;
                }

                if (masterOutput.trim()) {
                    net.bridge = masterOutput.trim();
                }
            } catch (e) {
                // Ignore enrichment errors
            }
        }));

        // 3rd Fallback: /proc/net/dev if ip command failed completely
        if (networks.length === 0) {
            try {
                const procNet = await ssh.exec('cat /proc/net/dev', 5000);
                const lines = procNet.split('\n').slice(2); // Skip headers
                for (const line of lines) {
                    const match = line.trim().match(/^(\S+):/);
                    if (match) {
                        const name = match[1];
                        if (name !== 'lo') {
                            networks.push({
                                name,
                                ip: '-',
                                mac: '-',
                                state: 'UP', // Assume UP if active stats
                                type: 'unknown',
                                speed: '',
                                bridge: '',
                                slaves: []
                            });
                        }
                    }
                }
            } catch { /* ignore */ }
        }

        console.log('[Network] Parsed', networks.length, 'interfaces');
        return networks;
    } catch (e: any) {
        console.error('Failed to fetch network stats:', e);
        debug.push(`[Network] Error: ${e.message || String(e)}`);
        return [];
    }
}

async function getDiskStats(ssh: any, debug: string[]) {
    try {
        const cmd = `/usr/bin/lsblk -J -o NAME,SIZE,TYPE,MOUNTPOINT,MODEL,SERIAL,FSTYPE,ROTA,TRAN 2>&1 || /bin/lsblk -J -o NAME,SIZE,TYPE,MOUNTPOINT,MODEL,SERIAL,FSTYPE,ROTA,TRAN 2>&1 || lsblk -o NAME,SIZE,TYPE,MOUNTPOINT 2>&1`;
        debug.push(`[Disk] Running: ${cmd}`);
        const diskOutput = await ssh.exec(cmd, 30000);
        debug.push(`[Disk] Output (first 100 chars): ${diskOutput.substring(0, 100)}...`);

        let disks: DiskInfo[] = [];
        try {
            const diskJson = JSON.parse(diskOutput);
            const flatten = (devices: any[]): DiskInfo[] => {
                let result: DiskInfo[] = [];
                for (const dev of devices) {
                    if (dev.type === 'disk' || dev.type === 'part' || dev.type === 'lvm') {
                        result.push({
                            name: dev.name,
                            size: dev.size,
                            type: dev.type,
                            mountpoint: dev.mountpoint || '-',
                            model: dev.model || '',
                            serial: dev.serial || '',
                            filesystem: dev.fstype || '',
                            rotational: dev.rota === '1' || dev.rota === true,
                            transport: dev.tran || ''
                        });
                    }
                    if (dev.children) {
                        result = result.concat(flatten(dev.children));
                    }
                }
                return result;
            };
            disks = flatten(diskJson.blockdevices || []);
        } catch {
            // Fallback for non-JSON lsblk
            const lines = diskOutput.split('\n').slice(1);
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 3) {
                    disks.push({
                        name: parts[0].replace(/[├└─│]/g, '').trim(),
                        size: parts[1],
                        type: parts[2],
                        mountpoint: parts[3] || '-'
                    });
                }
            }
        }

        // Final fallback: simple partitions from /proc/partitions
        if (disks.length === 0) {
            try {
                // ... parsing logic could be added here but lsblk usually exists
                await ssh.exec('cat /proc/partitions', 5000);
            } catch (e) {
                // ignore
            }
        }

        console.log('[Disk] Parsed', disks.length, 'disks');
        return disks.filter(d => d.name);
    } catch (e: any) {
        console.error('Failed to fetch disk stats:', e);
        debug.push(`[Disk] Error: ${e.message || String(e)}`);
        return [];
    }
}

async function getPoolStats(ssh: any, debug: string[]) {
    const pools: StoragePool[] = [];

    // Use pvesm status - the standard Proxmox storage tool
    try {
        const cmd = `/usr/sbin/pvesm status -content images,rootdir,vztmpl,backup,iso 2>&1 || pvesm status -content images,rootdir,vztmpl,backup,iso 2>&1`;
        debug.push(`[Pools] Running: ${cmd}`);
        const pvesmOutput = await ssh.exec(cmd, 15000);
        debug.push(`[Pools] Output (first 100 chars): ${pvesmOutput.substring(0, 100)}...`);

        const lines = pvesmOutput.trim().split('\n');

        // Determine start index (skip header)
        const startIdx = lines[0]?.toLowerCase().startsWith('name') ? 1 : 0;

        for (let i = startIdx; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const parts = line.split(/\s+/);
            if (parts.length >= 6) {
                // pvesm status: Name Type Status Total Used Available %
                const name = parts[0];
                const type = parts[1];
                const total = parseInt(parts[3]) * 1024;
                const used = parseInt(parts[4]) * 1024;
                const available = parseInt(parts[5]) * 1024;
                const percent = parseFloat(parts[6].replace('%', ''));
                const freeBytes = available;

                pools.push({
                    name,
                    type: type as any,
                    size: formatBytesSimple(total),
                    used: formatBytesSimple(used),
                    free: formatBytesSimple(freeBytes),
                    available: formatBytesSimple(freeBytes),
                    capacity: percent,
                    health: parts[2] === 'active' ? 'ONLINE' : 'OFFLINE'
                });
            }
        }
    } catch (e: any) {
        console.error('Pool stats failed:', e);
        debug.push(`[Pools] Error: ${e.message || String(e)}`);
    }

    return pools;
}


export interface Filesystem {
    filesystem: string;
    size: string;
    used: string;
    avail: string;
    usePerc: string;
    mount: string;
}

async function getFileSystems(ssh: any, debug: string[]) {
    try {
        const cmd = 'df -h | grep -vE "^Filesystem|tmpfs|cdrom" || echo ""';
        debug.push(`[FS] Running: ${cmd}`);
        const output = await ssh.exec(cmd, 10000);

        const filesystems: Filesystem[] = [];
        const lines = output.trim().split('\n');

        for (const line of lines) {
            const parts = line.split(/\s+/);
            if (parts.length >= 6) {
                // Filesystem Size Used Avail Use% Mounted on
                // might be slight variations, but usually standard
                filesystems.push({
                    filesystem: parts[0],
                    size: parts[1],
                    used: parts[2],
                    avail: parts[3],
                    usePerc: parts[4],
                    mount: parts[5] // rest handled? df usually keeps mount at end
                });
            }
        }
        return filesystems.filter(f => f.size && f.mount && f.mount !== '');
    } catch (e: any) {
        debug.push(`[FS] Error: ${e.message}`);
        return [];
    }
}

export async function getServerInfo(server: any): Promise<{
    networks: NetworkInterface[];
    disks: DiskInfo[];
    pools: StoragePool[];
    filesystems: Filesystem[];
    system: SystemInfo;
    debug: string[];
} | null> {
    if (!server.ssh_key) return null;

    let ssh;
    const debug: string[] = [];

    try {
        ssh = createSSHClient({
            ssh_host: server.ssh_host,
            ssh_port: server.ssh_port,
            ssh_user: server.ssh_user,
            ssh_key: server.ssh_key
        });
        await ssh.connect();
        debug.push('SSH Connected');

        const system = await getSystemStats(ssh);
        debug.push('System Stats Fetched');

        const [networks, disks, pools, filesystems] = await Promise.all([
            getNetworkStats(ssh, debug),
            getDiskStats(ssh, debug),
            getPoolStats(ssh, debug),
            getFileSystems(ssh, debug)
        ]);

        ssh.disconnect();

        return {
            networks,
            disks,
            pools,
            filesystems,
            system,
            debug
        };
    } catch (e) {
        console.error('[ServerDetail] Connection Error:', e);
        if (ssh) {
            try { ssh.disconnect(); } catch { }
        }
        return {
            networks: [],
            disks: [],
            pools: [],
            filesystems: [],
            system: {
                hostname: 'Connection Error', os: 'Error', kernel: '-', uptime: '-', cpu: '-', cpuCores: 0, cpuUsage: 0, memory: '-', memoryTotal: 0, memoryUsed: 0, memoryUsage: 0, loadAvg: '-'
            },
            debug: [`Connection Failed: ${e instanceof Error ? e.message : String(e)}`]
        };
    }
}


export interface SmartInfo {
    device: string;
    health: 'PASSED' | 'FAILED' | 'UNKNOWN';
    model: string;
    serial: string;
    temperature?: number;
    powerOnHours?: number;
    wearLevel?: number; // 0-100%
    reallocatedSectors?: number;
}

export interface ZfsHealth {
    pool: string;
    health: string;
    status: string;
    errors: string;
}

export interface SystemEvent {
    timestamp: string;
    message: string;
    type: 'OOM' | 'SERVICE' | 'OTHER';
}

export interface ServerHealth {
    smart: SmartInfo[];
    zfs: ZfsHealth[];
    events: SystemEvent[];
    backups: BackupInfo[];
}

export interface BackupInfo {
    vmid: string;
    vmName: string;
    lastBackup: string; // ISO Date or 'Never'
    status: 'OK' | 'WARNING' | 'CRITICAL'; // Critical > 7 days, Warning > 3 days
}

async function getSmartStats(ssh: any, disks: DiskInfo[]): Promise<SmartInfo[]> {
    const smartData: SmartInfo[] = [];

    // Only check physical disks (sda, nvme0n1), skip partitions
    const physicalDisks = disks.filter(d => d.type === 'disk');

    await Promise.all(physicalDisks.map(async (disk) => {
        try {
            // Try JSON format first
            const output = await ssh.exec(`smartctl -j -a /dev/${disk.name}`, 8000).catch(() => null);

            if (output) {
                try {
                    const json = JSON.parse(output);
                    const passed = json.smart_status?.passed;

                    smartData.push({
                        device: disk.name,
                        health: passed ? 'PASSED' : 'FAILED',
                        model: json.model_name || disk.model || '',
                        serial: json.serial_number || disk.serial || '',
                        temperature: json.temperature?.current,
                        powerOnHours: json.power_on_time?.hours,
                        wearLevel: json.ata_smart_attributes?.table?.find((a: any) => a.id === 177 || a.id === 233)?.raw?.value ?? undefined, // SSD Wear Indicators
                        reallocatedSectors: json.ata_smart_attributes?.table?.find((a: any) => a.id === 5)?.raw?.value
                    });
                    return;
                } catch {
                    // Fallback if JSON parse fails
                }
            }

            // Fallback to text parsing if JSON failed or not supported
            // This is minimal fallback
            const textOutput = await ssh.exec(`smartctl -H -A /dev/${disk.name}`, 5000);
            const passed = textOutput.includes('PASSED');
            smartData.push({
                device: disk.name,
                health: passed ? 'PASSED' : (textOutput.includes('FAILED') ? 'FAILED' : 'UNKNOWN'),
                model: disk.model || '',
                serial: disk.serial || ''
            });

        } catch (e) {
            console.error(`SMART check failed for ${disk.name}`, e);
            smartData.push({
                device: disk.name,
                health: 'UNKNOWN',
                model: disk.model || '',
                serial: disk.serial || ''
            });
        }
    }));

    return smartData;
}

async function getZfsStats(ssh: any): Promise<ZfsHealth[]> {
    try {
        const output = await ssh.exec('zpool list -H -o name,health', 5000);
        if (!output) return [];

        return output.split('\n').filter(Boolean).map((line: string) => {
            const [name, health] = line.split(/\s+/);
            return {
                pool: name,
                health: health,
                status: health === 'ONLINE' ? 'OK' : 'DEGRADED',
                errors: '-'
            };
        });
    } catch {
        return [];
    }
}

async function getSystemEvents(ssh: any): Promise<SystemEvent[]> {
    const events: SystemEvent[] = [];
    try {
        // Check OOM Kills in dmesg
        const dmesg = await ssh.exec('dmesg -T | grep -i "Out of memory" | tail -n 5', 5000);
        dmesg.split('\n').filter(Boolean).forEach((line: string) => {
            events.push({
                timestamp: line.substring(0, 27).trim(), // Extract dmesg timestamp
                message: line.substring(27).trim(),
                type: 'OOM'
            });
        });

        // Could also check for failed systemd services
        const failedServices = await ssh.exec('systemctl list-units --state=failed --no-legend --plain', 5000);
        failedServices.split('\n').filter(Boolean).forEach((line: string) => {
            events.push({
                timestamp: 'Now',
                message: line.trim(),
                type: 'SERVICE'
            });
        });

    } catch {
        // Ignore
    }
    return events;
}



async function getBackupStats(ssh: any): Promise<BackupInfo[]> {
    const backups: BackupInfo[] = [];
    try {
        // 1. Get List of VMs running on this node
        const vmListRaw = await ssh.exec(`pvesh get /nodes/$(hostname)/qemu --output-format json 2>/dev/null || echo "[]"`);
        const vms = JSON.parse(vmListRaw);

        // 2. Find All Backups (optimized: simple find in common dump dirs)
        // Adjust paths if you use specific storages, but /var/lib/vz/dump is default + others usually mount somewhere
        // Better: use pvesm list to find actual backups

        // Get enabled storages that support backup
        const storageRaw = await ssh.exec(`pvesm status -content backup -enabled 1 --output-format json 2>/dev/null`);
        const storages = JSON.parse(storageRaw);

        const backupMap = new Map<string, Date>();

        for (const st of storages) {
            try {
                // List volume, size, format, vmid
                const filesRaw = await ssh.exec(`pvesm list ${st.storage} --content backup --output-format json 2>/dev/null`);
                const files = JSON.parse(filesRaw);

                for (const f of files) {
                    // volid: local:backup/vzdump-qemu-100-2025_01_01-12_00_00.vma.zst
                    // Extract VMID and Date
                    const match = f.volid.match(/vzdump-(?:qemu|lxc)-(\d+)-(\d{4}_\d{2}_\d{2}-\d{2}_\d{2}_\d{2})/);
                    if (match) {
                        const vmid = match[1];
                        const dateStr = match[2].replace('_', '-').replace('_', '-').replace('-', 'T').replace('_', ':').replace('_', ':');
                        // 2025-01-01T12:00:00
                        // Fix format: YYYY_MM_DD-HH_mm_ss -> YYYY-MM-DDTHH:mm:ss
                        const cleanDateStr = match[2].substring(0, 10).replace(/_/g, '-') + 'T' + match[2].substring(11).replace(/_/g, ':');

                        const date = new Date(cleanDateStr);
                        if (!isNaN(date.getTime())) {
                            const currentBest = backupMap.get(vmid);
                            if (!currentBest || date > currentBest) {
                                backupMap.set(vmid, date);
                            }
                        }
                    }
                }
            } catch { }
        }

        // 3. Compare
        const now = new Date();
        const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
        const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

        for (const vm of vms) {
            const last = backupMap.get(vm.vmid.toString());
            if (!last) {
                // No backup found? We might ignore it or mark as Critical if we assume everything needs backup
                // Let's mark as WARNING 'Never'
                backups.push({
                    vmid: vm.vmid.toString(),
                    vmName: vm.name,
                    lastBackup: 'Never',
                    status: 'WARNING'
                });
            } else {
                const diff = now.getTime() - last.getTime();
                let status: 'OK' | 'WARNING' | 'CRITICAL' = 'OK';

                if (diff > SEVEN_DAYS) status = 'CRITICAL';
                else if (diff > THREE_DAYS) status = 'WARNING';

                if (status !== 'OK') {
                    backups.push({
                        vmid: vm.vmid.toString(),
                        vmName: vm.name,
                        lastBackup: last.toISOString().split('T')[0],
                        status
                    });
                }
            }
        }

    } catch (e) {
        console.error('Backup check failed:', e);
    }
    return backups;
}

export async function getServerHealth(server: any): Promise<ServerHealth | null> {
    if (!server.ssh_key) return null;

    let ssh;
    try {
        ssh = createSSHClient({
            ssh_host: server.ssh_host,
            ssh_port: server.ssh_port,
            ssh_user: server.ssh_user,
            ssh_key: server.ssh_key
        });
        await ssh.connect();

        // Need disks first to check SMART
        // We reuse getDiskStats but suppress log output by passing dummy debug
        const disks = await getDiskStats(ssh, []);

        const [smart, zfs, events, backups] = await Promise.all([
            getSmartStats(ssh, disks),
            getZfsStats(ssh),
            getSystemEvents(ssh),
            getBackupStats(ssh)
        ]);

        ssh.disconnect();
        return { smart, zfs, events, backups };
    } catch (e) {
        if (ssh) ssh.disconnect();
        console.error('Health Check Failed:', e);
        return null;
    }
}
