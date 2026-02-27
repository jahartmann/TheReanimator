import { ConsoleClient } from './ConsoleClient';
import { getVMInfoForConsole } from '@/lib/actions/console';

interface ConsolePageProps {
    params: Promise<{ locale: string; id: string; vmid: string }>;
}

export default async function ConsolePage({ params }: ConsolePageProps) {
    const { locale, id, vmid } = await params;

    let vmInfo;
    try {
        vmInfo = await getVMInfoForConsole(parseInt(id), parseInt(vmid));
    } catch {
        return (
            <div className="flex items-center justify-center h-screen">
                <p className="text-destructive">VM/CT {vmid} not found on server {id}</p>
            </div>
        );
    }

    return (
        <ConsoleClient
            serverId={parseInt(id)}
            vmid={parseInt(vmid)}
            vmInfo={vmInfo}
        />
    );
}
