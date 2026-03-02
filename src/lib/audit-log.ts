import db from '@/lib/db';

export interface AuditEntry {
    id: number;
    timestamp: string;
    user_id: number | null;
    username: string;
    action: string;
    category: string;
    target_type: string | null;
    target_id: string | null;
    target_name: string | null;
    server_id: number | null;
    details: string | null;
    ip_address: string | null;
}

export interface AuditFilters {
    category?: string;
    username?: string;
    serverId?: number;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
}

/**
 * Log an audit event. Fire-and-forget, catches errors internally.
 */
export function logAudit(params: {
    userId?: number;
    username: string;
    action: string;
    category: string;
    targetType?: string;
    targetId?: string;
    targetName?: string;
    serverId?: number;
    details?: Record<string, any>;
    ipAddress?: string;
}): void {
    try {
        db.prepare(`
            INSERT INTO audit_log (user_id, username, action, category, target_type, target_id, target_name, server_id, details, ip_address)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            params.userId ?? null,
            params.username,
            params.action,
            params.category,
            params.targetType ?? null,
            params.targetId ?? null,
            params.targetName ?? null,
            params.serverId ?? null,
            params.details ? JSON.stringify(params.details) : null,
            params.ipAddress ?? null
        );
    } catch (e) {
        console.error('[Audit] Failed to log:', e);
    }
}

/**
 * Query audit logs with optional filters and pagination.
 */
export function getAuditLogs(filters?: AuditFilters): { logs: AuditEntry[]; total: number } {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters?.category) {
        conditions.push('category = ?');
        params.push(filters.category);
    }
    if (filters?.username) {
        conditions.push('username LIKE ?');
        params.push(`%${filters.username}%`);
    }
    if (filters?.serverId) {
        conditions.push('server_id = ?');
        params.push(filters.serverId);
    }
    if (filters?.from) {
        conditions.push('timestamp >= ?');
        params.push(filters.from);
    }
    if (filters?.to) {
        conditions.push('timestamp <= ?');
        params.push(filters.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;

    const total = (db.prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`).get(...params) as { count: number }).count;
    const logs = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as AuditEntry[];

    return { logs, total };
}
