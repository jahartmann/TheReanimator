'use server';

import db from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const AgentSchema = z.object({
    name: z.string().min(2),
    role: z.string().min(5),
    prompt: z.string().min(10),
    tools: z.array(z.string()).default([]),
});

export type CustomAgent = {
    id: number;
    name: string;
    role: string;
    prompt: string;
    tools: string[]; // stored as JSON string in DB
    created_at: string;
};

export async function createCustomAgent(data: z.infer<typeof AgentSchema>) {
    const valid = AgentSchema.parse(data);

    // Ensure table exists (quick & dirty migration)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS custom_agents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            prompt TEXT NOT NULL,
            tools TEXT NOT NULL DEFAULT '[]',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    db.prepare(`
        INSERT INTO custom_agents (name, role, prompt, tools)
        VALUES (?, ?, ?, ?)
    `).run(valid.name, valid.role, valid.prompt, JSON.stringify(valid.tools));

    revalidatePath('/organs');
    return { success: true };
}

export async function getCustomAgents(): Promise<CustomAgent[]> {
    try {
        const rows = db.prepare('SELECT * FROM custom_agents ORDER BY created_at DESC').all() as any[];
        return rows.map(r => ({
            ...r,
            tools: JSON.parse(r.tools || '[]')
        }));
    } catch (e) {
        // Table might not exist
        return [];
    }
}

export async function deleteCustomAgent(id: number) {
    db.prepare('DELETE FROM custom_agents WHERE id = ?').run(id);
    revalidatePath('/organs');
    return { success: true };
}
