import { getAllVMsForConsole } from '@/lib/actions/console';
import { ConsoleList } from './ConsoleList';

export default async function ConsolePage() {
    let vms: Awaited<ReturnType<typeof getAllVMsForConsole>> = [];
    try {
        vms = await getAllVMsForConsole();
    } catch {
        // fallback to empty list
    }

    return <ConsoleList initialVMs={vms} />;
}
