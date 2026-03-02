import { ConsoleClient } from './ConsoleClient';
import { getVMInfoForConsole } from '@/lib/actions/console';
import Link from 'next/link';

interface ConsolePageProps {
    params: Promise<{ locale: string; id: string; vmid: string }>;
}

export default async function ConsolePage({ params }: ConsolePageProps) {
    const { locale, id, vmid } = await params;

    let vmInfo;
    try {
        vmInfo = await getVMInfoForConsole(parseInt(id), parseInt(vmid));
    } catch (e: any) {
        return (
            <div className="flex flex-col items-center justify-center h-screen gap-4">
                <p className="text-destructive text-lg font-medium">
                    VM/CT {vmid} not found on server {id}
                </p>
                <p className="text-muted-foreground text-sm">{e?.message || 'Unknown error'}</p>
                <Link
                    href={`/${locale}/console`}
                    className="text-sm text-primary underline hover:no-underline"
                >
                    Back to Console
                </Link>
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
