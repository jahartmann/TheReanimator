import fs from 'fs/promises';
import path from 'path';

// Import existing memory systems to respect the "Whole Brain"
import { getJournalSummary } from '@/lib/agent/memory/journal';
import { getWorkingMemorySummary } from '@/lib/agent/memory/working';
import { getBrainSummaryForPrompt } from '@/lib/agent/memory/brain';
import { tools } from '@/lib/agent/tools';
import { getActiveToolDefinitions } from '@/lib/agent/dynamic-tools/registry';

/**
 * The Consciousness Organ.
 * Responsible for stitching together the Soul, Memory, and Heart into a cohesive self.
 * It integrates the distinct "Organ" markdown files with the dynamic "Working Memory" of the agent.
 */
export class Consciousness {
    private static instance: Consciousness;
    private basePath: string;

    private constructor() {
        this.basePath = path.join(process.cwd(), 'src', 'lib', 'organs');
    }

    public static getInstance(): Consciousness {
        if (!Consciousness.instance) {
            Consciousness.instance = new Consciousness();
        }
        return Consciousness.instance;
    }

    /**
     * Awakening: Reads all organ files AND existing dynamic memory to construct the System Prompt.
     * @param sessionId Optional session ID to retrieve specific working memory.
     */
    public async awaken(sessionId?: number): Promise<string> {
        // 1. Read the Static/Long-term Organs
        const soul = await this.readOrgan('soul', 'SOUL.md');
        const memoryMd = await this.readOrgan('brain', 'MEMORY.md');
        const user = await this.readOrgan('brain', 'USER.md');
        const toolsMd = await this.readOrgan('hands', 'TOOLS.md');

        // 2. Retrieve Dynamic/Short-term Memory (The "Existing Brain Structure")
        const workingMemory = sessionId ? getWorkingMemorySummary(sessionId) : '';
        const journal = getJournalSummary(); // Daily logs
        const vectorBrain = getBrainSummaryForPrompt(); // Legacy vector/file brain summary if any

        // 3. Build dynamic tool catalog
        const builtinToolNames = Object.keys(tools);
        const customToolDefs = getActiveToolDefinitions();
        const customToolNames = Object.keys(customToolDefs);
        const allToolNames = [...builtinToolNames, ...customToolNames];

        const dynamicToolList = allToolNames.map(name => {
            const def = (tools as any)[name] || customToolDefs[name];
            const desc = def?.description || '';
            return `- ${name}: ${desc}`;
        }).join('\n');

        const dynamicToolSection = `\n## Available Tools (${allToolNames.length})\n${dynamicToolList}\n`;

        // 4. Synthesize the "Grimoire" (System Prompt)
        const grimoire = [
            soul,
            "\n---",
            "## USER PROFILE (The Summoner)",
            user,
            "\n---",
            "## INFRASTRUCTURE ATLAS (Long-Term Memory)",
            memoryMd,
            vectorBrain ? `\n### Additional Knowledge\n${vectorBrain}` : '',
            "\n---",
            "## WORKING MEMORY (Current Context)",
            workingMemory || "(Stream of consciousness is empty)",
            "\n---",
            "## SYSTEM LOGS (Daily Journal)",
            journal || "(No logs for today)",
            "\n---",
            "## TOOLING & PROCEDURES",
            toolsMd,
            dynamicToolSection,
            "\n---",
            "## CURRENT SPACETIME",
            `Time: ${new Date().toLocaleString('de-DE')}`,
            `System: Reanimator v2.1 (Consciousness Integrated)`,
        ].join('\n');

        return grimoire;
    }

    /**
     * Reads a specific organ file.
     */
    private async readOrgan(organ: string, filename: string): Promise<string> {
        try {
            const filePath = path.join(this.basePath, organ, filename);
            return await fs.readFile(filePath, 'utf-8');
        } catch (error) {
            console.warn(`[Consciousness] Failed to read ${organ}/${filename}:`, error);
            return `[MISSING ORGAN: ${organ}/${filename}]`;
        }
    }

    /**
     * Checks the Heartbeat file for proactive tasks.
     */
    public async checkPulse(): Promise<string | null> {
        const heartbeat = await this.readOrgan('heart', 'HEARTBEAT.md');

        // Filter out comments and empty lines
        const lines = heartbeat.split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#') && !l.startsWith('summary:'));

        if (lines.length === 0) {
            return null;
        }

        return `
TIME TO ACT.
The Heartbeat (HEARTBEAT.md) requests the following checks:

${heartbeat}

Perform them now. If all is well, report "HEARTBEAT_OK".
    `.trim();
    }
}
