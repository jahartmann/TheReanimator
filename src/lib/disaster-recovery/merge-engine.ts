/**
 * Merge Engine
 * 
 * Intelligent merging for specific Proxmox config file formats:
 * - fstab: UUID mapping (old UUID → new UUID from blkid)
 * - network/interfaces: Bridge/Bond/IP merge
 * - hosts: Cluster node IP merge
 * - VM configs: Storage path updates
 */

import { parseFstab, parseBlkid, type FstabEntry, type BlkidEntry } from './config-differ';

// ═══════════════════════════════════════════════════════════════
// UUID MAPPING (for fstab)
// ═══════════════════════════════════════════════════════════════

export interface UUIDMapping {
    oldUUID: string;
    newUUID: string;
    device: string;
    mountpoint: string;
    fstype: string;
    /** Confidence: 'high' if mountpoint or device matches, 'low' if only type matches */
    confidence: 'high' | 'medium' | 'low';
    /** Human-readable description */
    description: { de: string; en: string };
}

/**
 * Generate UUID mapping suggestions from backup fstab and current blkid
 */
export function generateUUIDMapping(
    backupFstab: string,
    currentBlkid: string
): UUIDMapping[] {
    const fstabEntries = parseFstab(backupFstab).filter(e => !e.isComment && e.uuid);
    const blkidEntries = parseBlkid(currentBlkid).filter(e => e.uuid);
    const mappings: UUIDMapping[] = [];

    for (const fstabEntry of fstabEntries) {
        if (!fstabEntry.uuid) continue;

        // Check if UUID already exists in current system
        const existsInCurrent = blkidEntries.some(b => b.uuid === fstabEntry.uuid);
        if (existsInCurrent) continue; // UUID hasn't changed, no mapping needed

        // Try to find a match by filesystem type and rough device pattern
        let bestMatch: BlkidEntry | null = null;
        let confidence: 'high' | 'medium' | 'low' = 'low';

        // Strategy 1: Same device path (e.g. /dev/sda1 → /dev/sda1)
        const oldDeviceMatch = fstabEntry.device.match(/\/dev\/([a-z]+\d*)/);
        if (oldDeviceMatch) {
            const deviceMatch = blkidEntries.find(b =>
                b.device.includes(oldDeviceMatch[1]) &&
                b.type === fstabEntry.fstype &&
                !mappings.some(m => m.newUUID === b.uuid)
            );
            if (deviceMatch) {
                bestMatch = deviceMatch;
                confidence = 'high';
            }
        }

        // Strategy 2: Same label
        if (!bestMatch) {
            const labelMatch = blkidEntries.find(b =>
                b.label && b.type === fstabEntry.fstype &&
                !mappings.some(m => m.newUUID === b.uuid)
            );
            if (labelMatch) {
                bestMatch = labelMatch;
                confidence = 'medium';
            }
        }

        // Strategy 3: Same filesystem type (weakest match)
        if (!bestMatch) {
            const typeMatch = blkidEntries.find(b =>
                b.type === fstabEntry.fstype &&
                !mappings.some(m => m.newUUID === b.uuid)
            );
            if (typeMatch) {
                bestMatch = typeMatch;
                confidence = 'low';
            }
        }

        if (bestMatch && bestMatch.uuid) {
            mappings.push({
                oldUUID: fstabEntry.uuid,
                newUUID: bestMatch.uuid,
                device: bestMatch.device,
                mountpoint: fstabEntry.mountpoint,
                fstype: fstabEntry.fstype,
                confidence,
                description: {
                    de: `${fstabEntry.mountpoint} (${fstabEntry.fstype}): ${fstabEntry.uuid.substring(0, 8)}... → ${bestMatch.uuid.substring(0, 8)}... [${bestMatch.device}]`,
                    en: `${fstabEntry.mountpoint} (${fstabEntry.fstype}): ${fstabEntry.uuid.substring(0, 8)}... → ${bestMatch.uuid.substring(0, 8)}... [${bestMatch.device}]`,
                },
            });
        }
    }

    return mappings;
}

/**
 * Apply UUID mappings to fstab content
 */
export function applyUUIDMapping(fstabContent: string, mappings: UUIDMapping[]): string {
    let result = fstabContent;
    for (const mapping of mappings) {
        result = result.replace(
            new RegExp(mapping.oldUUID.replace(/[-]/g, '[-]'), 'g'),
            mapping.newUUID
        );
    }
    return result;
}

// ═══════════════════════════════════════════════════════════════
// HOSTS FILE MERGE
// ═══════════════════════════════════════════════════════════════

export interface HostsEntry {
    ip: string;
    hostnames: string[];
    isComment: boolean;
    raw: string;
}

function parseHosts(content: string): HostsEntry[] {
    return content.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return { ip: '', hostnames: [], isComment: true, raw: line };
        }
        const parts = trimmed.split(/\s+/);
        return {
            ip: parts[0] || '',
            hostnames: parts.slice(1),
            isComment: false,
            raw: line,
        };
    });
}

/**
 * Merge hosts files: keep entries from both, prefer live for conflicts
 */
export function mergeHosts(backupContent: string, liveContent: string): string {
    const backupEntries = parseHosts(backupContent);
    const liveEntries = parseHosts(liveContent);

    const result: string[] = [];
    const addedHostnames = new Set<string>();

    // First, add all live entries
    for (const entry of liveEntries) {
        result.push(entry.raw);
        for (const hostname of entry.hostnames) {
            addedHostnames.add(hostname.toLowerCase());
        }
    }

    // Then add backup entries for hostnames not in live
    for (const entry of backupEntries) {
        if (entry.isComment) continue;
        const newHostnames = entry.hostnames.filter(h => !addedHostnames.has(h.toLowerCase()));
        if (newHostnames.length > 0) {
            // Check if this is a Proxmox cluster entry (common pattern)
            const isClusterEntry = newHostnames.some(h =>
                !h.includes('localhost') && !h.includes('ip6-')
            );
            if (isClusterEntry) {
                result.push(`${entry.ip} ${newHostnames.join(' ')} # restored from backup`);
                for (const h of newHostnames) addedHostnames.add(h.toLowerCase());
            }
        }
    }

    return result.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// PVE CONFIG MERGE (storage.cfg, VM configs)
// ═══════════════════════════════════════════════════════════════

export interface PveConfigSection {
    type: string;
    name: string;
    properties: Record<string, string>;
    raw: string;
}

/**
 * Parse a PVE config file (storage.cfg, VM conf, etc.)
 * Format:
 *   section_type: name
 *       key value
 *       key value
 */
export function parsePveConfig(content: string): PveConfigSection[] {
    const sections: PveConfigSection[] = [];
    let currentSection: PveConfigSection | null = null;

    for (const line of content.split('\n')) {
        const sectionMatch = line.match(/^(\w+):\s*(.+)/);
        if (sectionMatch) {
            if (currentSection) sections.push(currentSection);
            currentSection = {
                type: sectionMatch[1],
                name: sectionMatch[2].trim(),
                properties: {},
                raw: line,
            };
        } else if (currentSection && line.match(/^\s+/)) {
            const propMatch = line.match(/^\s+(\S+)\s+(.*)/);
            if (propMatch) {
                currentSection.properties[propMatch[1]] = propMatch[2];
                currentSection.raw += '\n' + line;
            }
        } else if (line.trim() === '' && currentSection) {
            currentSection.raw += '\n';
        }
    }
    if (currentSection) sections.push(currentSection);

    return sections;
}

/**
 * Update storage paths in a VM config
 * For when storage names changed (e.g. "local-lvm" → "pve-storage")
 */
export function updateStoragePaths(
    vmConfig: string,
    storageMapping: Record<string, string>
): string {
    let result = vmConfig;
    for (const [oldStorage, newStorage] of Object.entries(storageMapping)) {
        // Replace storage references like "local-lvm:vm-100-disk-0"
        const regex = new RegExp(`\\b${escapeRegex(oldStorage)}:`, 'g');
        result = result.replace(regex, `${newStorage}:`);
    }
    return result;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ═══════════════════════════════════════════════════════════════
// GENERIC TEXT MERGE
// ═══════════════════════════════════════════════════════════════

export interface MergeConflict {
    lineNumber: number;
    backupLine: string;
    liveLine: string;
    resolved: boolean;
    resolution: 'backup' | 'live' | 'custom';
    customContent?: string;
}

/**
 * Simple line-by-line merge: take the one the user picks, or custom
 */
export function applyMergeResolutions(
    backupContent: string,
    liveContent: string,
    conflicts: MergeConflict[]
): string {
    const liveLines = liveContent.split('\n');

    for (const conflict of conflicts) {
        if (!conflict.resolved) continue;
        const idx = conflict.lineNumber - 1;
        if (idx < 0 || idx >= liveLines.length) continue;

        switch (conflict.resolution) {
            case 'backup':
                liveLines[idx] = conflict.backupLine;
                break;
            case 'custom':
                if (conflict.customContent !== undefined) {
                    liveLines[idx] = conflict.customContent;
                }
                break;
            case 'live':
                // Keep as is
                break;
        }
    }

    return liveLines.join('\n');
}
