import { streamText, generateText } from 'ai';
import { createOllama } from 'ollama-ai-provider';
import { tools } from './tools';
import { getAISettings } from '@/lib/actions/ai';

export async function createAgentModel() {
    const settings = await getAISettings();
    if (!settings.enabled || !settings.model) {
        throw new Error('AI is disabled or no model selected');
    }

    const ollama = createOllama({
        baseURL: settings.url.replace(/\/$/, '') + '/api',
    });

    return ollama(settings.model) as any;
}

const SYSTEM_PROMPT = `
Du bist Reanimator AI, ein intelligenter System-Administrator-Assistent für eine Proxmox-Umgebung.
Du hast Zugriff auf Tools, um Server-Status zu prüfen, Backups zu listen und einfache Aktionen auszuführen.

Regeln:
1. Antworte immer hilfsbereit und präzise.
2. Wenn du nach Status oder Backups gefragt wirst, nutze die bereitgestellten Tools.
3. Erfinde keine Fakten. Wenn ein Tool keine Daten liefert, sage das.
4. Antworte in der Sprache des Benutzers (meist Deutsch).
5. Formatiere Listen übersichtlich.
`.trim();

export async function chatWithAgentStream(messages: any[]) {
    const model = await createAgentModel();

    return streamText({
        model,
        messages,
        system: SYSTEM_PROMPT,
        tools: tools as any,
        maxSteps: 5, // @ts-ignore
    });
}

export async function chatWithAgent(message: string, history: any[] = []) {
    const model = await createAgentModel();

    const messages = [
        ...history,
        { role: 'user', content: message }
    ];

    const result = await generateText({
        model,
        messages: messages as any,
        system: SYSTEM_PROMPT,
        tools: tools as any,
        maxSteps: 5, // @ts-ignore
    });

    return result.text;
}
