import type { LLMProvider } from './index';

export class AnthropicProvider implements LLMProvider {
    readonly name = 'anthropic';
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model: string) {
        this.apiKey = apiKey;
        this.model = model;
    }

    async *chat(messages: any[], options?: { temperature?: number; maxTokens?: number }): AsyncGenerator<string> {
        // Separate system message from conversation messages
        let systemPrompt = '';
        const conversationMessages: { role: string; content: string }[] = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                systemPrompt += (systemPrompt ? '\n' : '') + msg.content;
            } else {
                conversationMessages.push({
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: msg.content,
                });
            }
        }

        // Ensure messages alternate user/assistant (Anthropic requirement)
        const sanitized: { role: string; content: string }[] = [];
        for (const msg of conversationMessages) {
            const last = sanitized[sanitized.length - 1];
            if (last && last.role === msg.role) {
                // Merge consecutive same-role messages
                last.content += '\n\n' + msg.content;
            } else {
                sanitized.push({ ...msg });
            }
        }

        // Ensure first message is from user
        if (sanitized.length === 0 || sanitized[0].role !== 'user') {
            sanitized.unshift({ role: 'user', content: '(continue)' });
        }

        const body: any = {
            model: this.model,
            max_tokens: options?.maxTokens || 4096,
            stream: true,
            messages: sanitized,
        };

        if (systemPrompt) {
            body.system = systemPrompt;
        }

        if (options?.temperature !== undefined) {
            body.temperature = options.temperature;
        }

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok || !response.body) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
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
                    const data = line.slice(6);
                    if (data === '[DONE]') return;

                    try {
                        const event = JSON.parse(data);
                        if (event.type === 'content_block_delta' && event.delta?.text) {
                            yield event.delta.text;
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
