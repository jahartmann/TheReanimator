'use client';

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { createConfigBackup } from '@/lib/actions/configBackup';
import { useTranslations } from 'next-intl';

export function BackupButton({ serverId }: { serverId: number }) {
    const t = useTranslations('configDetail');
    const [loading, setLoading] = useState(false);

    async function handleClick() {
        setLoading(true);
        try {
            const result = await createConfigBackup(serverId);
            if (result.success) {
                alert(t('backupCreatedSuccess', { message: result.message }));
            } else {
                alert(t('backupError', { message: result.message }));
            }
        } catch (err) {
            alert(t('unexpectedError'));
            console.error(err);
        } finally {
            setLoading(false);
            // Force refresh to show new backup in list
            window.location.reload();
        }
    }

    return (
        <Button onClick={handleClick} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {loading ? t('saving') : t('createBackup')}
        </Button>
    );
}
