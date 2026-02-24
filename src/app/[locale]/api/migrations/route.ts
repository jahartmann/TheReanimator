import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAllMigrationTasks, startServerMigration, startVMMigration } from '@/lib/actions/migration';
import { getVMs } from '@/lib/actions/vm';

export const dynamic = 'force-dynamic';


export async function GET() {
    try {
        const tasks = await getAllMigrationTasks();
        return NextResponse.json(tasks);
    } catch (e) {
        return NextResponse.json({ error: String(e) }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { sourceId, targetId, targetStorage, targetBridge, vms, mode, online } = body;

        if (!sourceId || !targetId) {
            return NextResponse.json({ error: 'Missing required fields: sourceId and targetId are required' }, { status: 400 });
        }

        let result;

        if (mode === 'vm' && vms?.length === 1) {
            // Single VM Migration
            const vm = vms[0];
            result = await startVMMigration(sourceId, targetId, {
                vmid: vm.vmid,
                type: vm.type,
                name: vm.name || `VM ${vm.vmid}`
            }, {
                targetStorage: targetStorage || undefined,
                targetBridge: targetBridge || undefined,
                autoVmid: true,
                online: online ?? false
            });
        } else {
            // Full Server Migration - load all VMs if not provided
            let vmList = vms;
            if (!vmList || vmList.length === 0) {
                console.log('[API] Loading VMs from source server...');
                vmList = await getVMs(sourceId);
            }

            if (!vmList || vmList.length === 0) {
                return NextResponse.json({ error: 'No VMs found on source server' }, { status: 400 });
            }

            result = await startServerMigration(sourceId, targetId, vmList, {
                targetStorage: targetStorage || undefined,
                targetBridge: targetBridge || undefined,
                autoVmid: true
            });
        }

        if (result.success) {
            return NextResponse.json({ taskId: result.taskId });
        } else {
            return NextResponse.json({ error: result.message }, { status: 500 });
        }
    } catch (e) {
        console.error('[API] Migration error:', e);
        return NextResponse.json({ error: String(e) }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        if (searchParams.get('all') === 'true') {
            const stmt = db.prepare("DELETE FROM migration_tasks WHERE status NOT IN ('running', 'pending')");
            const info = stmt.run();
            return NextResponse.json({ success: true, deleted: info.changes });
        }
        return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    } catch (e: any) {
        return NextResponse.json({ error: String(e) }, { status: 500 });
    }
}
