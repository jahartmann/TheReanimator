import { chatWithAgentGenerator } from '@/lib/agent/core';

export const maxDuration = 60;

export async function POST(req: Request) {
    try {
        const { messages } = await req.json();

        if (!messages || !Array.isArray(messages)) {
            return new Response('Invalid request: messages array required', { status: 400 });
        }

        // Initialize Generator
        const generator = chatWithAgentGenerator(messages[messages.length - 1].content, messages.slice(0, -1));

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const event of generator) {
                        if (event.type === 'text') {
                            // Standard Text Chunk
                            controller.enqueue(encoder.encode(`0:${JSON.stringify(event.content)}\n`));
                        }
                        else if (event.type === 'status') {
                            // Render status as italic blockquote
                            const msg = `\n> 🤖 *${event.content}*\n\n`;
                            controller.enqueue(encoder.encode(`0:${JSON.stringify(msg)}\n`));
                        }
                        else if (event.type === 'tool_start') {
                            // Render tool start
                            const msg = `\n> 🛠️ **Starte Tool:** \`${event.tool}\`...\n\n`;
                            controller.enqueue(encoder.encode(`0:${JSON.stringify(msg)}\n`));
                        }
                        else if (event.type === 'tool_end') {
                            // Optional: Show result summary? Or just checkmark.
                            // const msg = `\n> ✅ **Ergebnis:** \`${JSON.stringify(event.result).substring(0, 50)}...\`\n\n`;
                            // controller.enqueue(encoder.encode(`0:${JSON.stringify(msg)}\n`));
                        }
                        else if (event.type === 'error') {
                            const msg = `\n> ❌ **Fehler:** ${event.content}\n\n`;
                            controller.enqueue(encoder.encode(`0:${JSON.stringify(msg)}\n`));
                        }
                    }
                } catch (e: any) {
                    console.error('Stream Error:', e);
                    const msg = `\n\n**System Error:** ${e.message}\n`;
                    controller.enqueue(encoder.encode(`0:${JSON.stringify(msg)}\n`));
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
