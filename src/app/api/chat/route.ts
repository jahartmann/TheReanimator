import { chatWithAgentStream } from '@/lib/agent/core';

export const maxDuration = 60;

export async function POST(req: Request) {
    try {
        const { messages } = await req.json();

        if (!messages || !Array.isArray(messages)) {
            return new Response('Invalid request: messages array required', { status: 400 });
        }

        const result = await chatWithAgentStream(messages);

        // Return streaming response
        return (result as any).toDataStreamResponse();
    } catch (error: any) {
        console.error('[Chat API Error]', error);
        return new Response(
            error.message || 'Internal server error',
            { status: 500 }
        );
    }
}
