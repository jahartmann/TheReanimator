'use server';

import { listBrainEntries, searchBrain, deleteBrainEntry, type BrainEntry } from '@/lib/agent/memory/brain';
import type { BrainDomain } from '@/lib/agent/memory/domains';

export type { BrainEntry };

export async function getBrainEntries(params?: {
    domain?: string;
    limit?: number;
    orderBy?: 'recent' | 'importance' | 'accessed';
}): Promise<BrainEntry[]> {
    return listBrainEntries({
        domain: params?.domain as BrainDomain | undefined,
        limit: params?.limit || 100,
        orderBy: params?.orderBy || 'recent',
    });
}

export async function searchBrainEntries(query: string): Promise<BrainEntry[]> {
    const results = await searchBrain(query, 50);
    return results.map(r => r.entry);
}

export async function removeBrainEntry(key: string): Promise<boolean> {
    return deleteBrainEntry(key);
}
