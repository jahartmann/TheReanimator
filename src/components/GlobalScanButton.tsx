'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Activity, Loader2, Sparkles } from "lucide-react";
import { scanEntireInfrastructure } from '@/app/actions/scan';
import { getAISettings } from '@/app/actions/ai';
import { toast } from 'sonner';

export function GlobalScanButton() {
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
        if (!confirm('Gesamte Infrastruktur scannen? Dies kann einige Zeit dauern.')) return;

        setScanning(true);
        const toastId = toast.loading('Starte globalen Scan...');

        try {
            const res = await scanEntireInfrastructure();
            if (res.success) {
                toast.success(`Scan gestartet!`, {
                    id: toastId,
                    description: `Der Scan läuft jetzt im Hintergrund. Überprüfen Sie die Tasks für Details.`
                });
            } else {
                toast.error('Scan fehlgeschlagen: ' + res.error, { id: toastId });
            }
        } catch (e: any) {
            toast.error('Fehler: ' + e.message, { id: toastId });
        } finally {
            setScanning(false);
        }
    }

    return (
        <Button onClick={handleScan} disabled={scanning} variant="default" className="bg-indigo-600 hover:bg-indigo-700 text-white">
            {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}
            Global Scan
        </Button>
    );
}
