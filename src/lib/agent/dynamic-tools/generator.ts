/**
 * AI-powered tool generator - Creates tool code from natural language descriptions.
 */

import { getAISettings } from '@/lib/actions/ai';
import { registerTool } from './registry';

/**
 * Generate a custom tool from a description using Ollama.
 */
export async function generateToolFromDescription(params: {
    name: string;
    description: string;
    inputDescription: string;
    outputDescription: string;
}): Promise<{ success: boolean; toolId?: number; code?: string; error?: string }> {
    const settings = await getAISettings();
    if (!settings.enabled || !settings.model) {
        return { success: false, error: 'AI ist deaktiviert oder kein Modell konfiguriert.' };
    }

    const prompt = `Du bist ein TypeScript-Entwickler. Erstelle eine Tool-Funktion für einen IT-Admin-Agenten.

ANFORDERUNGEN:
- Name: ${params.name}
- Beschreibung: ${params.description}
- Input: ${params.inputDescription}
- Output: ${params.outputDescription}

REGELN:
- Der Code wird als Body einer async function execute(args) ausgeführt
- args enthält die Parameter als Objekt
- Gib das Ergebnis mit return zurück
- Nutze nur fetch() für HTTP-Aufrufe
- KEIN import/require von fs, child_process, etc.
- Gib IMMER ein Objekt mit { success: boolean, ... } zurück
- Fange Fehler mit try/catch ab

Antworte NUR mit dem JavaScript-Code, ohne Markdown-Codeblöcke oder Erklärungen.`;

    try {
        const baseUrl = settings.url.replace(/\/$/, '');
        const response = await fetch(`${baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: settings.model,
                prompt,
                stream: false,
            }),
        });

        if (!response.ok) {
            return { success: false, error: `Ollama API Fehler: ${response.status}` };
        }

        const data = await response.json();
        let code = data.response || '';

        // Clean up: strip markdown code blocks if present
        code = code.replace(/```(?:typescript|javascript|ts|js)?\n?/g, '').replace(/```/g, '').trim();

        if (!code) {
            return { success: false, error: 'Ollama hat keinen Code generiert.' };
        }

        // Register the tool (pending approval)
        const result = await registerTool({
            name: params.name,
            description: params.description,
            parametersSchema: { type: 'object', description: params.inputDescription },
            code,
        });

        return {
            ...result,
            code,
        };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}
