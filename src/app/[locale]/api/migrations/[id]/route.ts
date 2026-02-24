import db from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;

        // Use the same query logic as getMigrationTask in actions/migration.ts
        const stmt = db.prepare(`
            SELECT 
                mt.*,
                s1.name as source_name,
                s2.name as target_name
            FROM migration_tasks mt
            LEFT JOIN servers s1 ON mt.source_server_id = s1.id
            LEFT JOIN servers s2 ON mt.target_server_id = s2.id
            WHERE mt.id = ?
        `);

        const task = stmt.get(id) as any;

        if (!task) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        // Parse steps from JSON column
        let steps = [];
        try {
            steps = JSON.parse(task.steps_json || '[]');
        } catch (e) {
            steps = [];
        }

        const fullTask = {
            ...task,
            steps: steps
        };

        return NextResponse.json(fullTask);
    } catch (error: any) {
        console.error('Get migration failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const stmt = db.prepare('DELETE FROM migration_tasks WHERE id = ?');
        const info = stmt.run(id);

        if (info.changes === 0) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        // Also delete steps? Foreign key cascade should handle it if enabled, otherwise manual.
        db.prepare('DELETE FROM migration_steps WHERE task_id = ?').run(id);

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Delete migration failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
