/**
 * Custom Tool Registry - Load, register, deactivate, execute.
 */

import db from '@/lib/db';
import { compileToolCode } from './compiler';
import { createSandboxContext, analyzeToolSafety } from './safety';

export interface CustomTool {
    id: number;
    name: string;
    description: string;
    parameters_schema: Record<string, any>;
    code: string;
    compiled_code: string | null;
    version: number;
    status: 'pending' | 'approved' | 'active' | 'deprecated' | 'disabled';
    safety_level: string;
    approved_by: number | null;
    created_at: string;
    last_used: string | null;
    usage_count: number;
}

// In-memory cache of active tools
let activeTools: Map<string, { tool: CustomTool; executeFn: Function }> = new Map();

/**
 * Load all active custom tools into memory.
 */
export function loadActiveTools(): number {
    activeTools.clear();

    const tools = db.prepare(
        "SELECT * FROM custom_tools WHERE status = 'active'"
    ).all() as CustomTool[];

    for (const tool of tools) {
        try {
            const executeFn = createExecuteFunction(tool);
            activeTools.set(tool.name, { tool, executeFn });
        } catch (e) {
            console.error(`[CustomTools] Failed to load tool ${tool.name}:`, e);
        }
    }

    console.log(`[CustomTools] Loaded ${activeTools.size} active tools`);
    return activeTools.size;
}

/**
 * Get all active custom tools as tool definitions (for merging with built-in tools).
 */
export function getActiveToolDefinitions(): Record<string, { description: string; execute: Function }> {
    const defs: Record<string, { description: string; execute: Function }> = {};

    for (const [name, { tool, executeFn }] of activeTools) {
        defs[name] = {
            description: tool.description,
            execute: async (args: any) => {
                const startTime = Date.now();
                try {
                    const result = await executeFn(args);
                    logToolExecution(name, args, result, Date.now() - startTime, 'success');
                    return result;
                } catch (e: any) {
                    logToolExecution(name, args, null, Date.now() - startTime, 'error', e.message);
                    return { success: false, error: e.message };
                }
            },
        };
    }

    return defs;
}

/**
 * Register a new custom tool (status: pending, requires admin approval).
 */
export async function registerTool(params: {
    name: string;
    description: string;
    parametersSchema: Record<string, any>;
    code: string;
}): Promise<{ success: boolean; toolId?: number; error?: string; safetyLevel?: string }> {
    // Check for name conflicts
    const existing = db.prepare('SELECT id FROM custom_tools WHERE name = ?').get(params.name);
    if (existing) {
        return { success: false, error: `Tool "${params.name}" existiert bereits.` };
    }

    // Compile and validate
    const compilation = await compileToolCode(params.code);
    if (!compilation.success) {
        return { success: false, error: compilation.error, safetyLevel: compilation.safetyLevel };
    }

    const result = db.prepare(`
        INSERT INTO custom_tools (name, description, parameters_schema, code, compiled_code, safety_level, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(
        params.name,
        params.description,
        JSON.stringify(params.parametersSchema),
        params.code,
        compilation.compiledCode || null,
        compilation.safetyLevel
    );

    return {
        success: true,
        toolId: result.lastInsertRowid as number,
        safetyLevel: compilation.safetyLevel,
    };
}

/**
 * Approve a pending custom tool (admin only).
 */
export function approveTool(toolId: number, approvedBy: number): boolean {
    const result = db.prepare(`
        UPDATE custom_tools SET status = 'active', approved_by = ?
        WHERE id = ? AND status = 'pending'
    `).run(approvedBy, toolId);

    if (result.changes > 0) {
        // Reload tools
        loadActiveTools();
        return true;
    }
    return false;
}

/**
 * Disable a custom tool.
 */
export function disableTool(toolId: number): boolean {
    const result = db.prepare(
        "UPDATE custom_tools SET status = 'disabled' WHERE id = ?"
    ).run(toolId);

    if (result.changes > 0) {
        loadActiveTools();
        return true;
    }
    return false;
}

/**
 * List all custom tools with optional status filter.
 */
export function listCustomTools(status?: string): CustomTool[] {
    let sql = 'SELECT * FROM custom_tools';
    const args: any[] = [];
    if (status) {
        sql += ' WHERE status = ?';
        args.push(status);
    }
    sql += ' ORDER BY created_at DESC';
    return db.prepare(sql).all(...args) as CustomTool[];
}

/**
 * Get tool execution audit log.
 */
export function getToolAuditLog(toolName?: string, limit: number = 50): any[] {
    let sql = 'SELECT * FROM tool_audit_log';
    const args: any[] = [];
    if (toolName) {
        sql += ' WHERE tool_name = ?';
        args.push(toolName);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    args.push(limit);
    return db.prepare(sql).all(...args);
}

// --- Internal ---

function createExecuteFunction(tool: CustomTool): Function {
    const code = tool.compiled_code || tool.code;
    const sandbox = createSandboxContext();

    // Wrap code in a function that receives args and sandbox context
    const wrappedCode = `
        return async function execute(args) {
            ${code}
        }
    `;

    try {
        const factory = new Function(...Object.keys(sandbox), wrappedCode);
        return factory(...Object.values(sandbox));
    } catch (e: any) {
        throw new Error(`Tool ${tool.name} konnte nicht geladen werden: ${e.message}`);
    }
}

function logToolExecution(
    toolName: string,
    args: any,
    result: any,
    executionTimeMs: number,
    status: string,
    error?: string
): void {
    try {
        db.prepare(`
            INSERT INTO tool_audit_log (tool_name, arguments, result, execution_time_ms, status, error_message)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            toolName,
            JSON.stringify(args),
            result ? JSON.stringify(result).slice(0, 10000) : null,
            executionTimeMs,
            status,
            error || null
        );

        // Update usage stats
        db.prepare(`
            UPDATE custom_tools SET usage_count = usage_count + 1, last_used = datetime('now')
            WHERE name = ?
        `).run(toolName);
    } catch {
        // Non-critical
    }
}
