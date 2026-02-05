import { chatWithAgentStream } from '@/lib/agent/core';

export const maxDuration = 60;

export async function POST(req: Request) {
    try {
        const { messages } = await req.json();

        if (!messages || !Array.isArray(messages)) {
            return new Response('Invalid request: messages array required', { status: 400 });
        }

        // Get streaming response from Ollama
        const ollamaResponse = await chatWithAgentStream(messages);

        // Convert Ollama's NDJSON stream to SSE format for the frontend
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                const reader = ollamaResponse.body?.getReader();
                if (!reader) {
                    controller.close();
                    return;
                }

                const decoder = new TextDecoder();
                let buffer = '';

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (!line.trim()) continue;
                            try {
                                const json = JSON.parse(line);
                                if (json.message?.content) {
                                    // Send as AI SDK compatible format
                                    controller.enqueue(encoder.encode(`0:${JSON.stringify(json.message.content)}\n`));
                                }
                            } catch {
                                // Skip malformed lines
                            }
                        }
                    }
                } finally {
                    controller.close();
                }
            }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            }
        });
    } catch (error: any) {
        console.error('[Chat API Error]', error);
        return new Response(
            error.message || 'Internal server error',
            { status: 500 }
        );
    }
}
