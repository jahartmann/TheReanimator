/**
 * Config Analyzer
 * 
 * Analyzes a backup and categorizes all files against the Proxmox Config Map.
 * Detects cluster vs standalone scenario and adjusts recommendations accordingly.
 */

import fs from 'fs';
import path from 'path';
import {
    PROXMOX_CONFIG_MAP,
    matchConfigFile,
    type ProxmoxConfigFile,
    type ConfigCategory,
    type RiskLevel,
    type Recommendation
} from './proxmox-config-map';

export interface AnalyzedFile {
    /** Relative path in backup (e.g. "etc/pve/storage.cfg") */
    relativePath: string;
    /** Absolute path to the file in the backup directory */
    localPath: string;
    /** The matching config map entry, if any */
    configInfo: ProxmoxConfigFile | null;
    /** The file content (if text, null if binary) */
    content: string | null;
    /** File size in bytes */
    size: number;
    /** Whether the file was recognized by the config map */
    recognized: boolean;
    /** Adjusted recommendation based on scenario analysis */
    recommendation: Recommendation;
    /** Whether this file is a VM/CT config (extracted VMID) */
    vmId?: number;
    /** VM/CT name extracted from config */
    vmName?: string;
}

export interface AnalyzedCategory {
    category: ConfigCategory;
    files: AnalyzedFile[];
    /** Total files in this category */
    totalFiles: number;
    /** How many are recommended for restore/merge */
    actionRequired: number;
}

export interface BackupAnalysis {
    /** Is this a cluster backup? (has corosync.conf) */
    isCluster: boolean;
    /** Hostname from backup */
    hostname: string | null;
    /** All recognized files grouped by category */
    categories: AnalyzedCategory[];
    /** Unrecognized files */
    unrecognized: AnalyzedFile[];
    /** Total number of files in backup */
    totalFiles: number;
    /** Number of recognized files */
    recognizedFiles: number;
    /** System info from SYSTEM_INFO.txt if available */
    systemInfo: string | null;
    /** Disk UUIDs from DISK_UUIDS.txt if available */
    diskUuids: string | null;
}

/**
 * Read file content safely (returns null for binary files)
 */
function readFileContent(filePath: string): string | null {
    try {
        const content = fs.readFileSync(filePath);
        // Check for binary content (null bytes)
        if (content.indexOf(0) !== -1) return null;
        return content.toString('utf-8');
    } catch {
        return null;
    }
}

/**
 * Extract VMID from a path like "etc/pve/nodes/node1/qemu-server/100.conf"
 */
function extractVMID(relativePath: string): number | undefined {
    const match = relativePath.match(/(?:qemu-server|lxc)\/(\d+)\.conf$/);
    if (match) return parseInt(match[1]);
    return undefined;
}

/**
 * Extract VM name from a PVE config file content
 */
function extractVMName(content: string): string | undefined {
    const match = content.match(/^name:\s*(.+)$/m);
    return match ? match[1].trim() : undefined;
}

/**
 * Analyze a backup directory and return structured analysis
 */
export function analyzeBackup(backupPath: string): BackupAnalysis {
    const analysis: BackupAnalysis = {
        isCluster: false,
        hostname: null,
        categories: [],
        unrecognized: [],
        totalFiles: 0,
        recognizedFiles: 0,
        systemInfo: null,
        diskUuids: null,
    };

    // Read system info files if they exist
    const sysInfoPath = path.join(backupPath, 'SYSTEM_INFO.txt');
    const diskUuidPath = path.join(backupPath, 'DISK_UUIDS.txt');
    if (fs.existsSync(sysInfoPath)) {
        analysis.systemInfo = fs.readFileSync(sysInfoPath, 'utf-8');
    }
    if (fs.existsSync(diskUuidPath)) {
        analysis.diskUuids = fs.readFileSync(diskUuidPath, 'utf-8');
    }

    // Collect all files recursively
    const allFiles: { relativePath: string; localPath: string; size: number }[] = [];

    function walk(dir: string, base: string) {
        if (!fs.existsSync(dir)) return;
        try {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                try {
                    const full = path.join(dir, item);
                    const relative = path.join(base, item).replace(/\\/g, '/');
                    const stat = fs.lstatSync(full);
                    if (stat.isDirectory()) {
                        walk(full, relative);
                    } else if (stat.isFile()) {
                        allFiles.push({ relativePath: relative, localPath: full, size: stat.size });
                    }
                } catch { /* skip individual file errors */ }
            }
        } catch { /* skip directory errors */ }
    }

    walk(backupPath, '');
    analysis.totalFiles = allFiles.length;

    // Filter out metadata files
    const configFiles = allFiles.filter(f =>
        !['SYSTEM_INFO.txt', 'DISK_UUIDS.txt', 'WIEDERHERSTELLUNG.md'].includes(f.relativePath)
    );

    // Detect cluster mode
    const hasCorosync = configFiles.some(f => f.relativePath.includes('pve/corosync.conf'));
    analysis.isCluster = hasCorosync;

    // Try to extract hostname from backup
    const hostnameFile = configFiles.find(f => f.relativePath === 'etc/hostname');
    if (hostnameFile) {
        const content = readFileContent(hostnameFile.localPath);
        if (content) analysis.hostname = content.trim();
    }

    // Analyze each file
    const categoryMap = new Map<ConfigCategory, AnalyzedFile[]>();

    for (const file of configFiles) {
        const remotePath = '/' + file.relativePath;
        const configInfo = matchConfigFile(remotePath) ?? null;
        const content = readFileContent(file.localPath);
        const vmId = extractVMID(file.relativePath);
        const vmName = vmId && content ? extractVMName(content) : undefined;

        let recommendation: Recommendation = 'compare-first';

        if (configInfo) {
            analysis.recognizedFiles++;

            // Adjust recommendation based on cluster/standalone
            if (analysis.isCluster && configInfo.autoSynced) {
                recommendation = 'skip'; // Auto-synced files should be skipped in cluster mode
            } else {
                recommendation = configInfo.consequences.recommendation;
            }
        }

        const analyzed: AnalyzedFile = {
            relativePath: file.relativePath,
            localPath: file.localPath,
            configInfo,
            content,
            size: file.size,
            recognized: !!configInfo,
            recommendation,
            vmId,
            vmName,
        };

        if (configInfo) {
            const cat = configInfo.category;
            if (!categoryMap.has(cat)) categoryMap.set(cat, []);
            categoryMap.get(cat)!.push(analyzed);
        } else {
            analysis.unrecognized.push(analyzed);
        }
    }

    // Build category list sorted by restore order
    const categoryOrder: ConfigCategory[] = ['system', 'network', 'storage', 'auth', 'cluster', 'vm', 'cron'];

    for (const cat of categoryOrder) {
        const files = categoryMap.get(cat) || [];
        if (files.length > 0) {
            // Sort files within category by restore order
            files.sort((a, b) => (a.configInfo?.restoreOrder ?? 999) - (b.configInfo?.restoreOrder ?? 999));

            analysis.categories.push({
                category: cat,
                files,
                totalFiles: files.length,
                actionRequired: files.filter(f => f.recommendation !== 'skip').length,
            });
        }
    }

    return analysis;
}
