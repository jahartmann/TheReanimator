import { z } from 'zod';
// import { type Tool } from '@/lib/agent/tools'; // Error: Tool not exported
import { Consciousness } from '@/lib/organs/consciousness';
import fs from 'fs/promises';
import path from 'path';

// Define Tool interface locally since it's not exported from tools.ts
interface Tool {
    name: string;
    description: string;
    parameters: z.ZodType<any>;
    execute: (args: any) => Promise<any>;
}

export const rememberTool: Tool = {
    name: 'remember',
    description: 'Stores a piece of information in your long-term memory (MEMORY.md). Use this for facts, preferences, or system details that should persist.',
    parameters: z.object({
        category: z.enum(['System Architecture', 'User Preferences', 'Incidents', 'Other']),
        content: z.string().describe('The knowledge to store. Be concise.'),
    }),
    execute: async ({ category, content }: { category: string, content: string }) => {
        try {
            const memoryPath = path.join(process.cwd(), 'src', 'lib', 'organs', 'brain', 'MEMORY.md');
            const entry = `\n- **${category}**: ${content} (Added: ${new Date().toLocaleDateString()})`;
            await fs.appendFile(memoryPath, entry, 'utf-8');
            return `Stored in Memory: ${content}`;
        } catch (error) {
            return `Failed to store memory: ${error}`;
        }
    },
};

export const recallTool: Tool = {
    name: 'recall',
    description: 'Retrieves your entire long-term memory.',
    parameters: z.object({}),
    execute: async () => {
        try {
            const consciousness = Consciousness.getInstance();
            // We reuse the awaken method or just read the file directly, 
            // but let's just read MEMORY.md for now as a specific tool action.
            const memoryPath = path.join(process.cwd(), 'src', 'lib', 'organs', 'brain', 'MEMORY.md');
            const memory = await fs.readFile(memoryPath, 'utf-8');
            return memory;
        } catch (error) {
            return `Failed to recall memory: ${error}`;
        }
    },
};
