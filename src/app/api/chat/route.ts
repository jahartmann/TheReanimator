import { chatWithAgentStream } from '@/lib/agent/core';

export const maxDuration = 60;

export async function POST(req: Request) {
    const { messages } = await req.json();

    try {
        const result = await chatWithAgentStream(messages);
        // @ts-ignore
        return result.toDataStreamResponse();
    } catch (error: any) {
        return new Response(error.message, { status: 500 });
    }
}
