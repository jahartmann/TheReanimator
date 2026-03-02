'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Camera, Loader2, RotateCcw, Trash2, Plus } from "lucide-react";
import { VirtualMachine } from '@/lib/actions/vm';
import { getSnapshots, createSnapshot, rollbackSnapshot, deleteSnapshot, SnapshotInfo } from '@/lib/actions/snapshot';
import { toast } from 'sonner';

interface SnapshotDialogProps {
    vm: VirtualMachine;
    serverId: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function SnapshotDialog({ vm, serverId, open, onOpenChange }: SnapshotDialogProps) {
    const t = useTranslations('snapshots');

    const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // Create form
    const [showCreate, setShowCreate] = useState(false);
    const [snapName, setSnapName] = useState('');
    const [snapDesc, setSnapDesc] = useState('');
    const [includeRAM, setIncludeRAM] = useState(false);
    const [creating, setCreating] = useState(false);

    const loadSnapshots = async () => {
        setLoading(true);
        try {
            const data = await getSnapshots(serverId, vm.vmid, vm.type);
            setSnapshots(data);
        } catch (e) {
            toast.error(t('loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) {
            loadSnapshots();
            setShowCreate(false);
            setSnapName('');
            setSnapDesc('');
            setIncludeRAM(false);
        }
    }, [open]);

    const handleCreate = async () => {
        if (!snapName.trim()) return;
        setCreating(true);
        try {
            const res = await createSnapshot(serverId, vm.vmid, vm.type, snapName.trim(), snapDesc.trim() || undefined, includeRAM);
            if (res.success) {
                toast.success(res.message);
                setShowCreate(false);
                setSnapName('');
                setSnapDesc('');
                setIncludeRAM(false);
                await loadSnapshots();
            } else {
                toast.error(res.message);
            }
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setCreating(false);
        }
    };

    const handleRollback = async (snapname: string) => {
        setActionLoading(snapname);
        try {
            const res = await rollbackSnapshot(serverId, vm.vmid, vm.type, snapname);
            if (res.success) {
                toast.success(res.message);
            } else {
                toast.error(res.message);
            }
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setActionLoading(null);
        }
    };

    const handleDelete = async (snapname: string) => {
        setActionLoading(snapname);
        try {
            const res = await deleteSnapshot(serverId, vm.vmid, vm.type, snapname);
            if (res.success) {
                toast.success(res.message);
                await loadSnapshots();
            } else {
                toast.error(res.message);
            }
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setActionLoading(null);
        }
    };

    const formatDate = (ts?: number) => {
        if (!ts) return '-';
        return new Date(ts * 1000).toLocaleString();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Camera className="h-5 w-5" />
                        {t('title')} — {vm.name} ({vm.vmid})
                    </DialogTitle>
                    <DialogDescription>
                        {t('description')}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Create Snapshot */}
                    {!showCreate ? (
                        <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
                            <Plus className="h-4 w-4 mr-2" />
                            {t('createSnapshot')}
                        </Button>
                    ) : (
                        <div className="p-4 border rounded-lg bg-muted/30 space-y-3 animate-in fade-in slide-in-from-top-2">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="mb-1.5 block text-sm">{t('snapshotName')}</Label>
                                    <Input
                                        value={snapName}
                                        onChange={(e) => setSnapName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                                        placeholder="snap-001"
                                        disabled={creating}
                                    />
                                </div>
                                <div>
                                    <Label className="mb-1.5 block text-sm">{t('snapshotDescription')}</Label>
                                    <Input
                                        value={snapDesc}
                                        onChange={(e) => setSnapDesc(e.target.value)}
                                        placeholder={t('descriptionPlaceholder')}
                                        disabled={creating}
                                    />
                                </div>
                            </div>
                            {vm.type === 'qemu' && (
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        id="includeRAM"
                                        checked={includeRAM}
                                        onCheckedChange={(v) => setIncludeRAM(!!v)}
                                        disabled={creating}
                                    />
                                    <Label htmlFor="includeRAM" className="text-sm cursor-pointer">{t('includeRAM')}</Label>
                                </div>
                            )}
                            <div className="flex gap-2">
                                <Button size="sm" onClick={handleCreate} disabled={!snapName.trim() || creating}>
                                    {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                                    {t('create')}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)} disabled={creating}>
                                    {t('cancel')}
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Snapshot List */}
                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : snapshots.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground text-sm">
                            <Camera className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p>{t('noSnapshots')}</p>
                        </div>
                    ) : (
                        <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b bg-muted/50">
                                        <th className="text-left p-2 font-medium">{t('name')}</th>
                                        <th className="text-left p-2 font-medium">{t('descriptionCol')}</th>
                                        <th className="text-left p-2 font-medium">{t('date')}</th>
                                        <th className="text-center p-2 font-medium">{t('ram')}</th>
                                        <th className="text-right p-2 font-medium">{t('actions')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {snapshots.map((snap) => (
                                        <tr key={snap.name} className="border-b last:border-0 hover:bg-muted/30">
                                            <td className="p-2 font-mono text-xs">{snap.name}</td>
                                            <td className="p-2 text-muted-foreground text-xs max-w-[150px] truncate">{snap.description || '-'}</td>
                                            <td className="p-2 text-xs text-muted-foreground">{formatDate(snap.snaptime)}</td>
                                            <td className="p-2 text-center">
                                                {snap.vmstate ? (
                                                    <span className="text-[10px] bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded">RAM</span>
                                                ) : (
                                                    <span className="text-muted-foreground text-xs">-</span>
                                                )}
                                            </td>
                                            <td className="p-2 text-right">
                                                <div className="flex gap-1 justify-end">
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7 text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
                                                                disabled={actionLoading === snap.name}
                                                                title={t('rollback')}
                                                            >
                                                                {actionLoading === snap.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>{t('confirmRollback')}</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    {t('rollbackWarning', { name: snap.name })}
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleRollback(snap.name)}>
                                                                    {t('rollback')}
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>

                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                                                disabled={actionLoading === snap.name}
                                                                title={t('deleteSnapshot')}
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>{t('confirmDelete')}</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    {t('deleteWarning', { name: snap.name })}
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleDelete(snap.name)} className="bg-red-600 hover:bg-red-700">
                                                                    {t('deleteSnapshot')}
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('close')}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
