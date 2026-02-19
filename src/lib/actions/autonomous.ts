'use server';

import { getAutonomousState, setAutonomousState, getRecentAutonomousLogs, type AutonomousLog } from '@/lib/autonomous/db';
import { revalidatePath } from 'next/cache';



export async function getAutonomousStatus() {
    return getAutonomousState('autonomous_mode') === 'true';
}

export async function toggleAutonomousMode(enabled: boolean) {
    setAutonomousState('autonomous_mode', String(enabled));
    revalidatePath('/[locale]/organs', 'page');
    return { success: true };
}

export async function getAutonomousLogs(limit = 20): Promise<AutonomousLog[]> {
    const logs = getRecentAutonomousLogs(limit);
    return JSON.parse(JSON.stringify(logs));
}

export async function getScripts() {
    const { listScripts } = await import('@/lib/agent/knowledge/script-library');
    const scripts = listScripts();
    return JSON.parse(JSON.stringify(scripts));
}

export async function getPatterns() {
    const { searchFacts } = await import('@/lib/agent/knowledge/base');
    const facts = await searchFacts('', 'patterns');
    return JSON.parse(JSON.stringify(facts));
}
