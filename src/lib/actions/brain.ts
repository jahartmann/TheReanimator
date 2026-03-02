'use server';

import { listBrainEntries, searchBrain, deleteBrainEntry, getBrainEntry, type BrainEntry } from '@/lib/agent/memory/brain';
import type { BrainDomain } from '@/lib/agent/memory/domains';
import db from '@/lib/db';

export type { BrainEntry };

export interface BrainSearchResult {
    entry: BrainEntry;
    snippet: string;
    rank: number;
}

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

export async function searchBrainEntriesAction(query: string, limit: number = 20): Promise<BrainSearchResult[]> {
    const results = await searchBrain(query, limit);
    return results.map(r => ({
        entry: r.entry,
        snippet: r.snippet,
        rank: r.rank,
    }));
}

export async function getBrainEntryDetail(key: string): Promise<BrainEntry | null> {
    return getBrainEntry(key);
}

export async function removeBrainEntry(key: string): Promise<boolean> {
    return deleteBrainEntry(key);
}

export async function getBrainStats(): Promise<{ total: number; domains: { domain: string; count: number }[] }> {
    const total = (db.prepare('SELECT COUNT(*) as count FROM brain_entries').get() as any)?.count || 0;
    const domains = db.prepare('SELECT domain, COUNT(*) as count FROM brain_entries GROUP BY domain ORDER BY count DESC').all() as { domain: string; count: number }[];
    return { total, domains };
}
