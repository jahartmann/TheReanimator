'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, Copy } from "lucide-react";
import { LibraryItem, syncLibraryItem, getEligibleStorages } from '@/lib/actions/library';
import { toast } from "sonner";

interface ServerOption {
    id: number;
    name: string;
}

interface SyncDialogProps {
    item: LibraryItem;
    servers: ServerOption[];
    onSuccess?: () => void;
}

export function SyncDialog({ item, servers, onSuccess }: SyncDialogProps) {
    const t = useTranslations('library');
    const [open, setOpen] = useState(false);
    const [targetServerId, setTargetServerId] = useState<string>("");
    const [targetStorage, setTargetStorage] = useState<string>("");
    const [storages, setStorages] = useState<string[]>([]);
    const [loadingStorages, setLoadingStorages] = useState(false);
    const [syncing, setSyncing] = useState(false);

    // Source is implicitly the first location?
    // User might want to pick *closest* source if multiple exist.
    // For now, we pick the first one.
    const sourceLocation = item.locations[0];

    const handleServerChange = async (value: string) => {
        setTargetServerId(value);
        setTargetStorage("");
        setLoadingStorages(true);
        try {
            const avail = await getEligibleStorages(parseInt(value), item.type);
            setStorages(avail);
            if (avail.length > 0) setTargetStorage(avail[0]);
        } catch (error) {
            toast.error(t('storageLoadError'));
        } finally {
            setLoadingStorages(false);
        }
    };

    const handleSync = async () => {
        if (!targetServerId || !targetStorage) return;
        setSyncing(true);
        try {
            await syncLibraryItem(
                sourceLocation.serverId,
                parseInt(targetServerId),
                sourceLocation.volid,
                targetStorage,
                item.type
            );
            toast.success(t('syncSuccess'), { description: t('syncSuccessDesc', { name: item.name }) });
            setOpen(false);
            if (onSuccess) onSuccess();
        } catch (error: any) {
            toast.error(t('syncError'), { description: error.message });
        } finally {
            setSyncing(false);
        }
    };

    const eligibleTargets = servers.filter(s => !item.locations.some(loc => loc.serverId === s.id));

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="sm" disabled={eligibleTargets.length === 0}>
                    <Copy className="h-4 w-4 mr-2" />
                    {t('syncButton')}
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('syncImageTitle')}</DialogTitle>
                    <DialogDescription>
                        {t('syncImageDesc', { name: item.name })}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label>{t('source')}</Label>
                        <div className="text-sm font-mono bg-muted p-2 rounded">
                            {sourceLocation.serverName} ({sourceLocation.storage})
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label>{t('targetServer')}</Label>
                        <Select value={targetServerId} onValueChange={handleServerChange}>
                            <SelectTrigger>
                                <SelectValue placeholder={t('selectServer')} />
                            </SelectTrigger>
                            <SelectContent>
                                {eligibleTargets.map(s => (
                                    <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {targetServerId && (
                        <div className="grid gap-2">
                            <Label>{t('targetStorage')}</Label>
                            <Select value={targetStorage} onValueChange={setTargetStorage} disabled={loadingStorages || storages.length === 0}>
                                <SelectTrigger>
                                    <SelectValue placeholder={loadingStorages ? t('loadingStorages') : t('selectStorage')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {storages.map(s => (
                                        <SelectItem key={s} value={s}>{s}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {storages.length === 0 && !loadingStorages && targetServerId && (
                                <p className="text-xs text-red-500">{t('noCompatibleStorage')}</p>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={syncing}>{t('cancel')}</Button>
                    <Button onClick={handleSync} disabled={!targetServerId || !targetStorage || syncing}>
                        {syncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {t('syncButton')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
