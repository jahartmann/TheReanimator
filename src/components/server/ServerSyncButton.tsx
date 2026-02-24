'use client';

import { useTranslations } from 'next-intl';
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { syncServerVMs } from "@/lib/actions/sync"; // Ensure sync.ts is created
import { toast } from "sonner";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface ServerSyncButtonProps {
    serverId: number;
}

export function ServerSyncButton({ serverId }: ServerSyncButtonProps) {
    const t = useTranslations('serverSync');
    const [syncing, setSyncing] = useState(false);
    const router = useRouter();

    const handleSync = async () => {
        setSyncing(true);
        try {
            const res = await syncServerVMs(serverId);
            toast.success(t('syncSuccessful'), {
                description: t('vmsUpdated', { count: res.count })
            });
            router.refresh();
        } catch (e: any) {
            toast.error(t('syncFailed'), {
                description: e.message
            });
        } finally {
            setSyncing(false);
        }
    };

    return (
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {t('sync')}
        </Button>
    );
}
