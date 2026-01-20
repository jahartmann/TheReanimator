'use client';

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { createConfigBackup } from '@/app/actions/configBackup';

export function BackupButton({ serverId }: { serverId: number }) {
    const [loading, setLoading] = useState(false);

    async function handleClick() {
        setLoading(true);
        try {
            const result = await createConfigBackup(serverId);
            if (result.success) {
                alert(`Backup erfolgreich!\n${result.message}`);
            } else {
                alert(`Backup fehlgeschlagen:\n${result.message}`);
            }
        } catch (err) {
            alert('Ein unerwarteter Fehler ist aufgetreten.');
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
            {loading ? 'Sichere...' : 'Jetzt sichern'}
        </Button>
    );
}
