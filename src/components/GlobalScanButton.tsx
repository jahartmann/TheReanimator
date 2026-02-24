'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Activity, Loader2, Sparkles } from "lucide-react";
import { scanEntireInfrastructure } from '@/lib/actions/scan';
import { getAISettings } from '@/lib/actions/ai';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

export function GlobalScanButton() {
    const t = useTranslations('globalScan');
    const [scanning, setScanning] = useState(false);
    const [aiEnabled, setAiEnabled] = useState(true);
    const [checking, setChecking] = useState(true);

    useEffect(() => {
        getAISettings().then(s => {
            setAiEnabled(s.enabled);
            setChecking(false);
        });
    }, []);

    if (!checking && !aiEnabled) return null;

    async function handleScan() {
        if (!confirm(t('confirmGlobalScan'))) return;

        setScanning(true);
        const toastId = toast.loading(t('startingGlobalScan'));

        try {
            const res = await scanEntireInfrastructure();
            if (res.success) {
                toast.success(t('scanStarted'), {
                    id: toastId,
                    description: t('scanRunningInBackground')
                });
            } else {
                toast.error(t('scanError') + res.error, { id: toastId });
            }
        } catch (e: any) {
            toast.error(t('error') + e.message, { id: toastId });
        } finally {
            setScanning(false);
        }
    }

    return (
        <Button onClick={handleScan} disabled={scanning} variant="default" className="bg-indigo-600 hover:bg-indigo-700 text-white">
            {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}
            {t('globalScan')}
        </Button>
    );
}
