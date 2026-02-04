'use server';

import { getDb } from '@/lib/db';
import { executeCommand, testConnection } from '@/lib/ssh';
import { revalidatePath } from 'next/cache';

export interface LinuxHost {
    id: number;
    name: string;
    hostname: string;
    port: number;
    username: string;
    ssh_key_path?: string;
    description?: string;
    tags: string[]; // parsed from JSON
    created_at: string;
}

export type LinuxHostStats = {
    uptime: string;
    cpu_usage: number; // percentage
    ram_usage: number; // percentage
    disk_usage: number; // percentage of root
    os_info: string;
};

// --- CRUD ---

export async function getLinuxHosts(): Promise<LinuxHost[]> {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM linux_hosts ORDER BY name ASC').all();

    return rows.map((row: any) => ({
        ...row,
        tags: JSON.parse(row.tags || '[]')
    }));
}

export async function addLinuxHost(data: {
    name: string;
    hostname: string;
    port: number;
    username: string;
    ssh_key_path?: string;
    description?: string;
}) {
    // 1. Validate Connection
    const isAlive = await testConnection({
        host: data.hostname,
        port: data.port,
        username: data.username,
        privateKeyPath: data.ssh_key_path
    });

    if (!isAlive) {
        return { success: false, error: 'SSH Connection Failed. Please check credentials and reachability.' };
    }

    // 2. Insert into DB
    const db = getDb();
    try {
        const stmt = db.prepare(`
            INSERT INTO linux_hosts (name, hostname, port, username, ssh_key_path, description, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            data.name,
            data.hostname,
            data.port,
            data.username,
            data.ssh_key_path || null,
            data.description || '',
            '[]'
        );

        revalidatePath('/');
        revalidatePath('/dashboard');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function removeLinuxHost(id: number) {
    const db = getDb();
    db.prepare('DELETE FROM linux_hosts WHERE id = ?').run(id);
    revalidatePath('/');
    revalidatePath('/dashboard');
    return { success: true };
}

// --- STATS ---

export async function getLinuxHostStats(id: number): Promise<LinuxHostStats | null> {
    const db = getDb();
    const host = db.prepare('SELECT * FROM linux_hosts WHERE id = ?').get(id) as any;

    if (!host) return null;

    const sshConfig = {
        host: host.hostname,
        port: host.port,
        username: host.username,
        privateKeyPath: host.ssh_key_path
    };

    try {
        // Run multiple commands in one go to save connections
        // 1. Uptime
        // 2. Free Memory (needed for calc)
        // 3. Disk usage (df -h /)
        // 4. CPU Load (top/uptime loadavg) - getting generic CPU usage properly is tricky without tools like mpstat. 
        // We'll use a trick: `top -bn1 | grep "Cpu(s)"` or `/proc/stat` parsing.

        // Let's grab /proc/stat snapshot for CPU? No, simple load average is easier for now.
        // Or better: `grep 'cpu ' /proc/stat` twice with delay? Too slow.
        // Simple approximation: `top -bn1 | grep "Cpu(s)"` (standard on most linux, might fail on some)

        const cmd = `
            uptime -p; 
            echo "---"; 
            free -m | grep Mem; 
            echo "---"; 
            df -h / | awk 'NR==2 {print $5}';
            echo "---";
            cat /etc/os-release | grep PRETTY_NAME
        `;

        const output = await executeCommand(sshConfig, cmd);
        if (!output) return null;

        const parts = output.split('---').map(s => s.trim());
        const uptime = parts[0];

        // Memory: "Mem:   7960    1544    3644      45    2771    6054"
        // total used free shared buff/cache available
        const memLine = parts[1].replace(/\s+/g, ' ').split(' ');
        const totalMem = parseInt(memLine[1]);
        const usedMem = parseInt(memLine[2]);
        const ramUsage = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;

        // Disk: "34%" -> 34
        const diskUsage = parseInt(parts[2].replace('%', '')) || 0;

        // OS Info
        const osInfo = parts[3].replace('PRETTY_NAME=', '').replace(/"/g, '');

        // CPU Usage Placeholder (getting real CPU % via SSH one-shot is messy)
        // We can just query loadavg from uptime or /proc/loadavg
        const loadAvgCmd = "cat /proc/loadavg";
        const loadAvgOut = await executeCommand(sshConfig, loadAvgCmd);
        const load1m = parseFloat(loadAvgOut.match(/(\d+\.\d+)/)?.[0] || '0');
        // Rough estimate: load / cpu_count * 100? No, let's just show load for now or random valid-ish number?
        // Let's try to get core count
        const cpuCountOut = await executeCommand(sshConfig, "nproc");
        const cpuCount = parseInt(cpuCountOut.trim()) || 1;
        const cpuUsage = Math.min(100, Math.round((load1m / cpuCount) * 100)); // Rough estimate based on load

        return {
            uptime,
            cpu_usage: cpuUsage,
            ram_usage: ramUsage,
            disk_usage: diskUsage,
            os_info: osInfo
        };

    } catch (e) {
        console.error(`Failed to get stats for host ${host.hostname}:`, e);
        return null;
    }
}
