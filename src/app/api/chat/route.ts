import { streamText, tool } from 'ai';
import { getLanguageModel } from '@/lib/ai/model';
import { toolsSchema } from '@/lib/ai/tools';
import { buildSystemContext } from '@/lib/ai/context';
import { listNodes, getStorageStatus, createVM, startVM, stopVM, installPackage } from '@/lib/ai/functions';
import { z } from 'zod';

export const maxDuration = 300; // 5 minutes

export async function POST(req: Request) {
    const { messages } = await req.json();

    // Cast model to any to avoid mismatch between V1/V2/V3 interfaces of ai-sdk implementations
    // This is safe because core functionality (text generation) is compatible.
    const model = (await getLanguageModel()) as any;

    // Convert toolsSchema to actual tools object with 'execute' placeholders for now
    // In Phase 2 we will fill the 'execute' functions.
    const tools = {
        list_nodes: tool({
            description: toolsSchema.list_nodes.description,
            parameters: toolsSchema.list_nodes.parameters,
            execute: async () => {
                return await listNodes();
            },
        }),
        get_storage_status: tool({
            description: 'Check storage usage on all servers.',
            parameters: z.object({}),
            execute: async () => {
                return await getStorageStatus();
            },
        }),
        create_vm: tool({
            description: toolsSchema.create_vm.description,
            parameters: toolsSchema.create_vm.parameters,
            execute: async (args: any) => {
                return await createVM(args.serverName, args.node, args);
            },
        }),
        start_vm: tool({
            description: toolsSchema.start_vm.description,
            parameters: toolsSchema.start_vm.parameters,
            execute: async (args: any) => {
                return await startVM(args.serverName, args.node, args.vmid);
            },
        }),
        stop_vm: tool({
            description: toolsSchema.stop_vm.description,
            parameters: toolsSchema.stop_vm.parameters,
            execute: async (args: any) => {
                return await stopVM(args.serverName, args.node, args.vmid);
            },
        }),
        install_package: tool({
            description: toolsSchema.install_package.description,
            parameters: toolsSchema.install_package.parameters,
            execute: async (args: any) => {
                return await installPackage(args.serverName, args.node, args.vmid, args.packageName);
            },
        }),
    };

    const systemMessage = await buildSystemContext();

    const result = streamText({
        model,
        messages,
        tools,
        system: systemMessage,
    });

    return (result as any).toDataStreamResponse();
}
