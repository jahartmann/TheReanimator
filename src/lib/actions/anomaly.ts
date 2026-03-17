'use server';

import db from '@/lib/db';
import { getCurrentUser } from '@/lib/actions/userAuth';

// --- Interfaces ---

export interface Anomaly {
    id: number;
    server_id: number;
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    details: Record<string, any>;
    ai_assessment: string | null;
    status: 'new' | 'acknowledged' | 'resolved';
    detected_at: string;
    resolved_at: string | null;
}

export interface AnomalyFilters {
    status?: 'new' | 'acknowledged' | 'resolved';
    severity?: 'low' | 'medium' | 'high' | 'critical';
}

export interface NetworkBaseline {
    id: number;
    server_id: number;
    baseline: {
        ports: Array<{ port: number; protocol: string; service?: string }>;
        arp: Array<{ ip: string; mac: string; hostname?: string }>;
        connections: Array<{ local_addr: string; remote_addr: string; state: string }>;
    };
    version: number;
    created_at: string;
}

export interface DetectedAnomaly {
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    details: Record<string, any>;
}

// --- CRUD ---

export async function getAnomalies(
    serverId?: number,
    filters?: AnomalyFilters
): Promise<Anomaly[]> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const conditions: string[] = [];
    const params: any[] = [];

    if (serverId !== undefined) {
        conditions.push('server_id = ?');
        params.push(serverId);
    }
    if (filters?.status) {
        conditions.push('status = ?');
        params.push(filters.status);
    }
    if (filters?.severity) {
        conditions.push('severity = ?');
        params.push(filters.severity);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(`
        SELECT * FROM anomalies
        ${where}
        ORDER BY detected_at DESC
        LIMIT 100
    `).all(...params) as any[];

    return rows.map(row => ({
        ...row,
        details: JSON.parse(row.details_json),
    }));
}

export async function acknowledgeAnomaly(anomalyId: number): Promise<{ success: boolean }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    db.prepare(`UPDATE anomalies SET status = 'acknowledged' WHERE id = ?`).run(anomalyId);
    return { success: true };
}

export async function resolveAnomaly(anomalyId: number): Promise<{ success: boolean }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    db.prepare(`
        UPDATE anomalies
        SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(anomalyId);
    return { success: true };
}

export async function bulkUpdateAnomalies(
    ids: number[],
    status: 'acknowledged' | 'resolved'
): Promise<{ success: boolean; updated: number }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    if (ids.length === 0) return { success: true, updated: 0 };

    const placeholders = ids.map(() => '?').join(', ');
    const resolvedFields =
        status === 'resolved'
            ? `, resolved_at = CURRENT_TIMESTAMP`
            : '';

    const result = db.prepare(`
        UPDATE anomalies
        SET status = ?${resolvedFields}
        WHERE id IN (${placeholders})
    `).run(status, ...ids) as { changes: number };

    return { success: true, updated: result.changes };
}

// --- Baseline ---

export async function getBaseline(serverId: number): Promise<NetworkBaseline | null> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const row = db.prepare(`
        SELECT * FROM network_baseline
        WHERE server_id = ?
        ORDER BY created_at DESC
        LIMIT 1
    `).get(serverId) as any;

    if (!row) return null;

    return {
        ...row,
        baseline: JSON.parse(row.baseline_json),
    };
}

export async function saveBaseline(serverId: number): Promise<{ success: boolean; version: number }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    // Fetch latest scans of each type
    const portScan = db.prepare(`
        SELECT result_json FROM network_scans
        WHERE server_id = ? AND scan_type = 'port'
        ORDER BY scanned_at DESC LIMIT 1
    `).get(serverId) as any;

    const arpScan = db.prepare(`
        SELECT result_json FROM network_scans
        WHERE server_id = ? AND scan_type = 'arp'
        ORDER BY scanned_at DESC LIMIT 1
    `).get(serverId) as any;

    const connScan = db.prepare(`
        SELECT result_json FROM network_scans
        WHERE server_id = ? AND scan_type = 'connections'
        ORDER BY scanned_at DESC LIMIT 1
    `).get(serverId) as any;

    const baseline = {
        ports: portScan ? JSON.parse(portScan.result_json) : [],
        arp: arpScan ? JSON.parse(arpScan.result_json) : [],
        connections: connScan ? JSON.parse(connScan.result_json) : [],
    };

    // Determine next version
    const lastVersion = db.prepare(`
        SELECT version FROM network_baseline
        WHERE server_id = ?
        ORDER BY version DESC LIMIT 1
    `).get(serverId) as { version: number } | undefined;

    const nextVersion = (lastVersion?.version ?? 0) + 1;

    db.prepare(`
        INSERT INTO network_baseline (server_id, baseline_json, version)
        VALUES (?, ?, ?)
    `).run(serverId, JSON.stringify(baseline), nextVersion);

    // Enforce 10-version limit: delete oldest entries beyond 10
    const countRow = db.prepare(`
        SELECT COUNT(*) as cnt FROM network_baseline WHERE server_id = ?
    `).get(serverId) as { cnt: number };

    if (countRow.cnt > 10) {
        db.prepare(`
            DELETE FROM network_baseline
            WHERE server_id = ? AND id NOT IN (
                SELECT id FROM network_baseline
                WHERE server_id = ?
                ORDER BY created_at DESC LIMIT 10
            )
        `).run(serverId, serverId);
    }

    return { success: true, version: nextVersion };
}

export async function addToBaseline(
    serverId: number,
    items: {
        ports?: Array<{ port: number; protocol: string; service?: string }>;
        arp?: Array<{ ip: string; mac: string; hostname?: string }>;
    }
): Promise<{ success: boolean }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const existing = await getBaseline(serverId);
    const baseline = existing?.baseline ?? { ports: [], arp: [], connections: [] };

    if (items.ports && items.ports.length > 0) {
        const existingKeys = new Set(
            baseline.ports.map((p: any) => `${p.port}/${p.protocol}`)
        );
        for (const p of items.ports) {
            const key = `${p.port}/${p.protocol}`;
            if (!existingKeys.has(key)) {
                baseline.ports.push(p);
                existingKeys.add(key);
            }
        }
    }

    if (items.arp && items.arp.length > 0) {
        const existingIPs = new Set(baseline.arp.map((a: any) => a.ip));
        for (const a of items.arp) {
            if (!existingIPs.has(a.ip)) {
                baseline.arp.push(a);
                existingIPs.add(a.ip);
            }
        }
    }

    if (existing) {
        // Update the latest baseline in-place
        db.prepare(`
            UPDATE network_baseline SET baseline_json = ? WHERE id = ?
        `).run(JSON.stringify(baseline), existing.id);
    } else {
        db.prepare(`
            INSERT INTO network_baseline (server_id, baseline_json, version)
            VALUES (?, ?, 1)
        `).run(serverId, JSON.stringify(baseline));
    }

    return { success: true };
}

// --- Anomaly Detection ---

export async function runAnomalyCheck(serverId: number): Promise<DetectedAnomaly[]> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const baseline = await getBaseline(serverId);
    if (!baseline) return [];

    // Fetch latest scans
    const latestPort = db.prepare(`
        SELECT result_json FROM network_scans
        WHERE server_id = ? AND scan_type = 'port'
        ORDER BY scanned_at DESC LIMIT 1
    `).get(serverId) as any;

    const latestArp = db.prepare(`
        SELECT result_json FROM network_scans
        WHERE server_id = ? AND scan_type = 'arp'
        ORDER BY scanned_at DESC LIMIT 1
    `).get(serverId) as any;

    const detected: DetectedAnomaly[] = [];

    // --- Port comparison ---
    if (latestPort) {
        const currentPorts: Array<{ port: number; protocol: string; service?: string }> =
            JSON.parse(latestPort.result_json);

        const baselinePortKeys = new Set(
            baseline.baseline.ports.map((p: any) => `${p.port}/${p.protocol}`)
        );
        const currentPortKeys = new Set(
            currentPorts.map((p: any) => `${p.port}/${p.protocol}`)
        );

        // New ports not in baseline
        for (const p of currentPorts) {
            const key = `${p.port}/${p.protocol}`;
            if (!baselinePortKeys.has(key)) {
                detected.push({
                    type: 'new_port',
                    severity: 'medium',
                    details: { port: p.port, protocol: p.protocol, service: p.service ?? null },
                });
            }
        }

        // Closed ports that were in baseline
        for (const p of baseline.baseline.ports) {
            const key = `${p.port}/${p.protocol}`;
            if (!currentPortKeys.has(key)) {
                detected.push({
                    type: 'closed_port',
                    severity: 'low',
                    details: { port: p.port, protocol: p.protocol, service: p.service ?? null },
                });
            }
        }
    }

    // --- ARP comparison ---
    if (latestArp) {
        const currentArp: Array<{ ip: string; mac: string; hostname?: string }> =
            JSON.parse(latestArp.result_json);

        const baselineArpByIP = new Map(
            baseline.baseline.arp.map((a: any) => [a.ip, a])
        );

        for (const entry of currentArp) {
            const baselineEntry = baselineArpByIP.get(entry.ip);
            if (!baselineEntry) {
                // Unknown IP
                detected.push({
                    type: 'unknown_ip',
                    severity: 'high',
                    details: { ip: entry.ip, mac: entry.mac, hostname: entry.hostname ?? null },
                });
            } else if (
                baselineEntry.mac &&
                entry.mac &&
                baselineEntry.mac.toLowerCase() !== entry.mac.toLowerCase()
            ) {
                // MAC address changed — possible ARP spoofing
                detected.push({
                    type: 'mac_change',
                    severity: 'critical',
                    details: {
                        ip: entry.ip,
                        old_mac: baselineEntry.mac,
                        new_mac: entry.mac,
                        hostname: entry.hostname ?? null,
                    },
                });
            }
        }
    }

    if (detected.length === 0) return [];

    // --- Deduplication: skip if same type+details exists in last hour ---
    const recentRows = db.prepare(`
        SELECT type, details_json FROM anomalies
        WHERE server_id = ? AND detected_at >= datetime('now', '-1 hour')
    `).all(serverId) as Array<{ type: string; details_json: string }>;

    const recentKeys = new Set(
        recentRows.map(r => {
            const d = JSON.parse(r.details_json);
            return deduplicationKey(r.type, d);
        })
    );

    const toInsert = detected.filter(a => {
        const key = deduplicationKey(a.type, a.details);
        return !recentKeys.has(key);
    });

    if (toInsert.length === 0) return [];

    // Insert new anomalies
    const insertStmt = db.prepare(`
        INSERT INTO anomalies (server_id, type, severity, details_json, status)
        VALUES (?, ?, ?, ?, 'new')
    `);

    const insertAll = db.transaction((items: DetectedAnomaly[]) => {
        for (const a of items) {
            insertStmt.run(serverId, a.type, a.severity, JSON.stringify(a.details));
        }
    });

    insertAll(toInsert);

    return toInsert;
}

// --- Helpers ---

function deduplicationKey(type: string, details: Record<string, any>): string {
    switch (type) {
        case 'new_port':
        case 'closed_port':
            return `${type}:${details.port}/${details.protocol}`;
        case 'unknown_ip':
            return `${type}:${details.ip}`;
        case 'mac_change':
            return `${type}:${details.ip}:${details.new_mac}`;
        default:
            return `${type}:${JSON.stringify(details)}`;
    }
}
