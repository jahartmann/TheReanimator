import type { LLMProvider } from './index';

export class OllamaProvider implements LLMProvider {
    readonly name = 'ollama';
    private baseUrl: string;
    private model: string;

    constructor(baseUrl: string, model: string) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.model = model;
    }

    async *chat(messages: any[], options?: { temperature?: number; maxTokens?: number }): AsyncGenerator<string> {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                messages,
                stream: true,
                ...(options?.temperature !== undefined && {
                    options: { temperature: options.temperature },
                }),
            }),
        });

        if (!response.ok || !response.body) {
            throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = (buffer + chunk).split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const json = JSON.parse(line);
                        if (json.message?.content) {
                            yield json.message.content;
                        }
                    } catch {
                        // ignore malformed lines
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
}
