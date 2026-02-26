/**
 * Config Differ
 * 
 * Compares backup files with live files on the server.
 * Produces line-by-line diffs with special detection for
 * UUID changes, IP changes, and path changes.
 */

export interface DiffLine {
    type: 'unchanged' | 'added' | 'removed' | 'modified';
    lineNumber: { backup: number | null; live: number | null };
    content: string;
    /** Original content (for modified lines) */
    originalContent?: string;
    /** Special detection results */
    detection?: DiffDetection;
}

export interface DiffDetection {
    type: 'uuid-change' | 'ip-change' | 'path-change' | 'key-change';
    oldValue: string;
    newValue: string;
    description: { de: string; en: string };
}

export interface DiffResult {
    /** The file path being compared */
    filePath: string;
    /** Whether files are identical */
    identical: boolean;
    /** Number of changed lines */
    changedLines: number;
    /** The diff lines */
    lines: DiffLine[];
    /** Detected special changes (UUIDs, IPs, etc.) */
    detections: DiffDetection[];
    /** Whether the backup file exists */
    backupExists: boolean;
    /** Whether the live file exists */
    liveExists: boolean;
    /** Backup content */
    backupContent: string | null;
    /** Live content */
    liveContent: string | null;
}

/**
 * Simple LCS-based diff algorithm
 */
function computeLCS(a: string[], b: string[]): boolean[][] {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to find which elements are in the LCS
    const inLCSa: boolean[] = new Array(m).fill(false);
    const inLCSb: boolean[] = new Array(n).fill(false);

    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (a[i - 1] === b[j - 1]) {
            inLCSa[i - 1] = true;
            inLCSb[j - 1] = true;
            i--;
            j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }

    return [inLCSa, inLCSb] as any;
}

/**
 * Detect UUID changes in a line
 */
function detectUUIDChange(oldLine: string, newLine: string): DiffDetection | null {
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const oldUUIDs = oldLine.match(uuidRegex);
    const newUUIDs = newLine.match(uuidRegex);

    if (oldUUIDs && newUUIDs && oldUUIDs.length > 0 && newUUIDs.length > 0) {
        // Check if same position in line has different UUID
        const oldBase = oldLine.replace(uuidRegex, 'UUID');
        const newBase = newLine.replace(uuidRegex, 'UUID');
        if (oldBase === newBase && oldUUIDs[0] !== newUUIDs[0]) {
            return {
                type: 'uuid-change',
                oldValue: oldUUIDs[0],
                newValue: newUUIDs[0],
                description: {
                    de: `UUID geändert: ${oldUUIDs[0]} → ${newUUIDs[0]} (Festplatte getauscht?)`,
                    en: `UUID changed: ${oldUUIDs[0]} → ${newUUIDs[0]} (disk replaced?)`
                }
            };
        }
    }
    return null;
}

/**
 * Detect IP address changes
 */
function detectIPChange(oldLine: string, newLine: string): DiffDetection | null {
    const ipRegex = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;
    const oldIPs = oldLine.match(ipRegex);
    const newIPs = newLine.match(ipRegex);

    if (oldIPs && newIPs && oldIPs.length > 0 && newIPs.length > 0) {
        const oldBase = oldLine.replace(ipRegex, 'IP');
        const newBase = newLine.replace(ipRegex, 'IP');
        if (oldBase === newBase && oldIPs[0] !== newIPs[0]) {
            return {
                type: 'ip-change',
                oldValue: oldIPs[0],
                newValue: newIPs[0],
                description: {
                    de: `IP-Adresse geändert: ${oldIPs[0]} → ${newIPs[0]}`,
                    en: `IP address changed: ${oldIPs[0]} → ${newIPs[0]}`
                }
            };
        }
    }
    return null;
}

/**
 * Detect storage path changes in PVE config
 */
function detectPathChange(oldLine: string, newLine: string): DiffDetection | null {
    // Detect storage path changes like "local-lvm:vm-100-disk-0" → "ssd-storage:vm-100-disk-0"
    const storageRegex = /([a-zA-Z0-9_-]+):(vm-\d+-disk-\d+|subvol-\d+-disk-\d+|basevol-\d+-disk-\d+)/;
    const oldMatch = oldLine.match(storageRegex);
    const newMatch = newLine.match(storageRegex);

    if (oldMatch && newMatch && oldMatch[1] !== newMatch[1]) {
        return {
            type: 'path-change',
            oldValue: oldMatch[0],
            newValue: newMatch[0],
            description: {
                de: `Storage-Pfad geändert: ${oldMatch[0]} → ${newMatch[0]}`,
                en: `Storage path changed: ${oldMatch[0]} → ${newMatch[0]}`
            }
        };
    }
    return null;
}

/**
 * Compute a diff between backup content and live content
 */
export function computeDiff(
    filePath: string,
    backupContent: string | null,
    liveContent: string | null
): DiffResult {
    const result: DiffResult = {
        filePath,
        identical: false,
        changedLines: 0,
        lines: [],
        detections: [],
        backupExists: backupContent !== null,
        liveExists: liveContent !== null,
        backupContent,
        liveContent,
    };

    // Handle missing files
    if (!backupContent && !liveContent) {
        result.identical = true;
        return result;
    }

    if (!backupContent) {
        // File only exists on live
        const liveLines = liveContent!.split('\n');
        result.changedLines = liveLines.length;
        result.lines = liveLines.map((line, i) => ({
            type: 'added' as const,
            lineNumber: { backup: null, live: i + 1 },
            content: line,
        }));
        return result;
    }

    if (!liveContent) {
        // File only exists in backup
        const backupLines = backupContent.split('\n');
        result.changedLines = backupLines.length;
        result.lines = backupLines.map((line, i) => ({
            type: 'removed' as const,
            lineNumber: { backup: i + 1, live: null },
            content: line,
        }));
        return result;
    }

    // Both exist — compute diff
    if (backupContent === liveContent) {
        result.identical = true;
        const lines = backupContent.split('\n');
        result.lines = lines.map((line, i) => ({
            type: 'unchanged' as const,
            lineNumber: { backup: i + 1, live: i + 1 },
            content: line,
        }));
        return result;
    }

    // Line-by-line diff using LCS
    const backupLines = backupContent.split('\n');
    const liveLines = liveContent.split('\n');
    const [inLCSa, inLCSb] = computeLCS(backupLines, liveLines);

    let bi = 0, li = 0;

    while (bi < backupLines.length || li < liveLines.length) {
        if (bi < backupLines.length && inLCSa[bi]) {
            if (li < liveLines.length && inLCSb[li]) {
                // Both in LCS — unchanged
                result.lines.push({
                    type: 'unchanged',
                    lineNumber: { backup: bi + 1, live: li + 1 },
                    content: backupLines[bi],
                });
                bi++;
                li++;
            } else if (li < liveLines.length) {
                // Live line not in LCS — added
                result.lines.push({
                    type: 'added',
                    lineNumber: { backup: null, live: li + 1 },
                    content: liveLines[li],
                });
                result.changedLines++;
                li++;
            }
        } else if (bi < backupLines.length) {
            // Backup line not in LCS — removed
            // Check if the next live line is a modification of this line
            if (li < liveLines.length && !inLCSb[li]) {
                // Both lines are not in LCS — could be a modification
                const detection =
                    detectUUIDChange(backupLines[bi], liveLines[li]) ||
                    detectIPChange(backupLines[bi], liveLines[li]) ||
                    detectPathChange(backupLines[bi], liveLines[li]);

                if (detection) {
                    result.detections.push(detection);
                }

                result.lines.push({
                    type: 'modified',
                    lineNumber: { backup: bi + 1, live: li + 1 },
                    content: liveLines[li],
                    originalContent: backupLines[bi],
                    detection: detection || undefined,
                });
                result.changedLines++;
                bi++;
                li++;
            } else {
                result.lines.push({
                    type: 'removed',
                    lineNumber: { backup: bi + 1, live: null },
                    content: backupLines[bi],
                });
                result.changedLines++;
                bi++;
            }
        } else if (li < liveLines.length) {
            // Only live lines remaining
            result.lines.push({
                type: 'added',
                lineNumber: { backup: null, live: li + 1 },
                content: liveLines[li],
            });
            result.changedLines++;
            li++;
        }
    }

    return result;
}

/**
 * Parse fstab content into structured entries for UUID mapping
 */
export interface FstabEntry {
    device: string;
    mountpoint: string;
    fstype: string;
    options: string;
    dump: string;
    pass: string;
    uuid?: string;
    isComment: boolean;
    raw: string;
}

export function parseFstab(content: string): FstabEntry[] {
    return content.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return {
                device: '', mountpoint: '', fstype: '', options: '',
                dump: '', pass: '', isComment: true, raw: line
            };
        }

        const parts = trimmed.split(/\s+/);
        const device = parts[0] || '';
        const uuidMatch = device.match(/UUID=([0-9a-fA-F-]+)/);

        return {
            device,
            mountpoint: parts[1] || '',
            fstype: parts[2] || '',
            options: parts[3] || '',
            dump: parts[4] || '',
            pass: parts[5] || '',
            uuid: uuidMatch ? uuidMatch[1] : undefined,
            isComment: false,
            raw: line,
        };
    });
}

/**
 * Parse blkid output into a map of UUID -> device
 */
export interface BlkidEntry {
    device: string;
    uuid?: string;
    type?: string;
    label?: string;
    partLabel?: string;
}

export function parseBlkid(output: string): BlkidEntry[] {
    return output.split('\n').filter(l => l.trim()).map(line => {
        const deviceMatch = line.match(/^([^:]+):/);
        const uuidMatch = line.match(/\bUUID="([^"]+)"/);
        const typeMatch = line.match(/\bTYPE="([^"]+)"/);
        const labelMatch = line.match(/\bLABEL="([^"]+)"/);
        const partLabelMatch = line.match(/\bPARTLABEL="([^"]+)"/);

        return {
            device: deviceMatch ? deviceMatch[1].trim() : '',
            uuid: uuidMatch ? uuidMatch[1] : undefined,
            type: typeMatch ? typeMatch[1] : undefined,
            label: labelMatch ? labelMatch[1] : undefined,
            partLabel: partLabelMatch ? partLabelMatch[1] : undefined,
        };
    });
}
