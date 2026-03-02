import { getTranslations } from 'next-intl/server';
import { createTerminalSession, validateTerminalAccess } from '@/lib/actions/console';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import ConsoleTabsClient from '@/components/console/ConsoleTabsClient';

interface ConsolePageProps {
    params: Promise<{ locale: string; id: string; vmid: string }>;
}

export default async function ConsolePage({ params }: ConsolePageProps) {
    const { locale, id, vmid } = await params;
    const serverId = parseInt(id);
    const t = await getTranslations({ locale, namespace: 'console' });

    const access = await validateTerminalAccess(serverId, vmid);

    if (!access.valid) {
        return (
            <div className="flex flex-col items-center justify-center h-[80vh] gap-4">
                <AlertTriangle className="h-12 w-12 text-yellow-500" />
                <h1 className="text-xl font-semibold">{t('terminal')}</h1>
                <p className="text-muted-foreground">{access.error}</p>
                <Link
                    href={`/${locale}/servers/${serverId}`}
                    className="text-sm text-blue-500 hover:underline flex items-center gap-1"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Server
                </Link>
            </div>
        );
    }

    const { sessionId, wsUrl } = await createTerminalSession(serverId, vmid);

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] p-4 gap-3">
            <div className="flex items-center gap-3">
                <Link
                    href={`/${locale}/servers/${serverId}`}
                    className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                    <ArrowLeft className="h-4 w-4" />
                </Link>
                <h1 className="text-lg font-semibold">
                    {t('terminal')} — {access.serverName} / VM {vmid}
                </h1>
            </div>

            <div className="flex-1 min-h-0">
                <ConsoleTabsClient
                    wsUrl={wsUrl}
                    serverName={access.serverName}
                    vmid={vmid}
                    serverId={serverId}
                />
            </div>
        </div>
    );
}
