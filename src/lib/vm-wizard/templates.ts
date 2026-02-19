/**
 * VM Template management - Save, load, and create VMs from templates.
 */

import db from '@/lib/db';

export interface VMTemplate {
    id: number;
    name: string;
    description: string | null;
    icon: string;
    base_type: 'vm' | 'lxc';
    default_cores: number;
    default_memory: number;
    default_disk: string;
    default_os_type: string;
    auto_start: boolean;
    monitoring_profile_id: number | null;
    provisioning_profile_id: number | null;
    tags: string[];
    created_at: string;
}

/**
 * List all VM templates.
 */
export function listTemplates(): VMTemplate[] {
    const rows = db.prepare('SELECT * FROM vm_templates ORDER BY name').all() as any[];
    return rows.map(parseTemplate);
}

/**
 * Get a template by ID.
 */
export function getTemplate(id: number): VMTemplate | null {
    const row = db.prepare('SELECT * FROM vm_templates WHERE id = ?').get(id) as any;
    return row ? parseTemplate(row) : null;
}

/**
 * Create a new VM template.
 */
export function createTemplate(params: {
    name: string;
    description?: string;
    icon?: string;
    baseType: 'vm' | 'lxc';
    defaultCores?: number;
    defaultMemory?: number;
    defaultDisk?: string;
    defaultOsType?: string;
    autoStart?: boolean;
    provisioningProfileId?: number;
    tags?: string[];
}): number {
    const result = db.prepare(`
        INSERT INTO vm_templates (name, description, icon, base_type, default_cores,
            default_memory, default_disk, default_os_type, auto_start,
            provisioning_profile_id, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        params.name,
        params.description || null,
        params.icon || 'server',
        params.baseType,
        params.defaultCores || 2,
        params.defaultMemory || 2048,
        params.defaultDisk || '32G',
        params.defaultOsType || 'l26',
        params.autoStart ? 1 : 0,
        params.provisioningProfileId || null,
        JSON.stringify(params.tags || [])
    );

    return result.lastInsertRowid as number;
}

/**
 * Delete a template.
 */
export function deleteTemplate(id: number): boolean {
    const result = db.prepare('DELETE FROM vm_templates WHERE id = ?').run(id);
    return result.changes > 0;
}

function parseTemplate(row: any): VMTemplate {
    return {
        ...row,
        auto_start: !!row.auto_start,
        tags: safeJsonParse(row.tags, []),
    };
}

function safeJsonParse(str: string | null, fallback: any): any {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
}
