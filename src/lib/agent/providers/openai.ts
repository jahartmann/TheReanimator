import type { LLMProvider } from './index';

export class OpenAIProvider implements LLMProvider {
    readonly name = 'openai';
    private apiKey: string;
    private model: string;
    private baseUrl: string;

    constructor(apiKey: string, model: string, baseUrl: string = 'https://api.openai.com/v1') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    async *chat(messages: any[], options?: { temperature?: number; maxTokens?: number }): AsyncGenerator<string> {
        const body: any = {
            model: this.model,
            messages: messages.map(m => ({
                role: m.role,
                content: m.content,
            })),
            stream: true,
        };

        if (options?.temperature !== undefined) {
            body.temperature = options.temperature;
        }
        if (options?.maxTokens !== undefined) {
            body.max_tokens = options.maxTokens;
        }

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok || !response.body) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
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
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') return;

                    try {
                        const event = JSON.parse(data);
                        const content = event.choices?.[0]?.delta?.content;
                        if (content) {
                            yield content;
                        }
                    } catch {
                        // ignore malformed events
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
}
