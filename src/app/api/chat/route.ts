import { chatWithAgentGenerator } from '@/lib/agent/core';
import { getCurrentUser } from '@/lib/actions/userAuth';

export const maxDuration = 60;

export async function POST(req: Request) {
    try {
        const user = await getCurrentUser();
        if (!user) {
            return new Response('Unauthorized', { status: 401 });
        }

        const { messages, sessionId } = await req.json();

        if (!messages || !Array.isArray(messages)) {
            return new Response('Invalid request: messages array required', { status: 400 });
        }

        const generator = chatWithAgentGenerator(
            messages[messages.length - 1].content,
            messages.slice(0, -1),
            sessionId || undefined
        );

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const event of generator) {
                        switch (event.type) {
                            case 'text':
                                // Pure content — rendered as markdown in chat bubble
                                controller.enqueue(encoder.encode(`0:${JSON.stringify(event.content)}\n`));
                                break;
                            case 'session':
                                controller.enqueue(encoder.encode(`s:${JSON.stringify({ id: event.id })}\n`));
                                break;
                            case 'status':
                                // Transient status — shown as indicator, NOT in message
                                controller.enqueue(encoder.encode(`i:${JSON.stringify(event.content)}\n`));
                                break;
                            case 'tool_start':
                                // Tool indicator — rendered as collapsible pill
                                controller.enqueue(encoder.encode(`t:${JSON.stringify(event.tool)}\n`));
                                break;
                            case 'tool_end':
                                // Signal tool completion
                                controller.enqueue(encoder.encode(`T:${JSON.stringify(event.tool)}\n`));
                                break;
                            case 'error':
                                // Error — shown inline in message
                                const errMsg = `\n\n> **Fehler:** ${event.content}\n\n`;
                                controller.enqueue(encoder.encode(`0:${JSON.stringify(errMsg)}\n`));
                                break;
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
