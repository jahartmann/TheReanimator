'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HardDrive, Loader2, Play, RotateCcw, Archive } from "lucide-react";
import { VirtualMachine } from '@/lib/actions/vm';
import { getBackupStorages, triggerVMBackup, getVMBackups, restoreVMBackup, BackupEntry } from '@/lib/actions/snapshot';
import { toast } from 'sonner';

interface BackupDialogProps {
    vm: VirtualMachine;
    serverId: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function BackupDialog({ vm, serverId, open, onOpenChange }: BackupDialogProps) {
    const t = useTranslations('snapshots');

    // Backup create
    const [storages, setStorages] = useState<string[]>([]);
    const [selectedStorage, setSelectedStorage] = useState('');
    const [compress, setCompress] = useState('zstd');
    const [mode, setMode] = useState('snapshot');
    const [backupRunning, setBackupRunning] = useState(false);
    const [backupLogs, setBackupLogs] = useState<string[]>([]);

    // Backup list
    const [backups, setBackups] = useState<BackupEntry[]>([]);
    const [loadingBackups, setLoadingBackups] = useState(false);

    // Restore
    const [restoreVolid, setRestoreVolid] = useState('');
    const [restoreVmid, setRestoreVmid] = useState(vm.vmid);
    const [restoreStorage, setRestoreStorage] = useState('');
    const [restoring, setRestoring] = useState(false);
    const [restoreLogs, setRestoreLogs] = useState<string[]>([]);

    const [loadingStorages, setLoadingStorages] = useState(false);

    const logsEndRef = useRef<HTMLDivElement>(null);
    const restoreLogsEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [backupLogs]);

    useEffect(() => {
        restoreLogsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [restoreLogs]);

    useEffect(() => {
        if (open) {
            loadStorages();
            loadBackups();
            setBackupLogs([]);
            setRestoreLogs([]);
            setBackupRunning(false);
            setRestoring(false);
        }
    }, [open]);

    const loadStorages = async () => {
        setLoadingStorages(true);
        try {
            const data = await getBackupStorages(serverId);
            setStorages(data);
            if (data.length > 0) {
                setSelectedStorage(data[0]);
                setRestoreStorage(data[0]);
            }
        } catch {
            toast.error(t('loadStoragesFailed'));
        } finally {
            setLoadingStorages(false);
        }
    };

    const loadBackups = async () => {
        setLoadingBackups(true);
        try {
            const data = await getVMBackups(serverId, vm.vmid);
            setBackups(data);
        } catch {
            toast.error(t('loadBackupsFailed'));
        } finally {
            setLoadingBackups(false);
        }
    };

    const handleBackup = async () => {
        if (!selectedStorage) return;
        setBackupRunning(true);
        setBackupLogs([t('backupStarting', { name: vm.name })]);

        try {
            const res = await triggerVMBackup(serverId, vm.vmid, vm.type, {
                storage: selectedStorage,
                compress,
                mode,
            });
            if (res.success) {
                setBackupLogs(prev => [...prev, res.message]);
                if (res.taskId) {
                    setBackupLogs(prev => [...prev, `Task: ${res.taskId}`]);
                }
                toast.success(res.message);
                // Refresh backup list after a short delay
                setTimeout(() => loadBackups(), 3000);
            } else {
                setBackupLogs(prev => [...prev, `Error: ${res.message}`]);
                toast.error(res.message);
            }
        } catch (e: any) {
            setBackupLogs(prev => [...prev, `Exception: ${e.message}`]);
            toast.error(e.message);
        } finally {
            setBackupRunning(false);
        }
    };

    const handleRestore = async () => {
        if (!restoreVolid || !restoreVmid || !restoreStorage) return;
        setRestoring(true);
        setRestoreLogs([t('restoreStarting', { volid: restoreVolid })]);

        try {
            const res = await restoreVMBackup(serverId, restoreVolid, restoreVmid, restoreStorage, vm.type);
            if (res.success) {
                setRestoreLogs(prev => [...prev, res.message]);
                toast.success(res.message);
            } else {
                setRestoreLogs(prev => [...prev, `Error: ${res.message}`]);
                toast.error(res.message);
            }
        } catch (e: any) {
            setRestoreLogs(prev => [...prev, `Exception: ${e.message}`]);
            toast.error(e.message);
        } finally {
            setRestoring(false);
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '-';
        const gb = bytes / (1024 * 1024 * 1024);
        if (gb >= 1) return `${gb.toFixed(1)} GB`;
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(0)} MB`;
    };

    const formatDate = (ts: number) => {
        if (!ts) return '-';
        return new Date(ts * 1000).toLocaleString();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[750px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <HardDrive className="h-5 w-5" />
                        {t('backupTitle')} — {vm.name} ({vm.vmid})
                    </DialogTitle>
                    <DialogDescription>
                        {t('backupDescription')}
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="create" className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="create">{t('createBackup')}</TabsTrigger>
                        <TabsTrigger value="list">{t('existingBackups')}</TabsTrigger>
                        <TabsTrigger value="restore">{t('restore')}</TabsTrigger>
                    </TabsList>

                    {/* Create Backup Tab */}
                    <TabsContent value="create" className="space-y-4 mt-4">
                        {backupLogs.length === 0 ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <Label className="mb-1.5 block text-sm">{t('storage')}</Label>
                                        {loadingStorages ? (
                                            <div className="h-10 flex items-center px-3 border rounded-md bg-muted text-muted-foreground text-sm">
                                                <Loader2 className="h-3 w-3 animate-spin mr-2" /> {t('loading')}
                                            </div>
                                        ) : (
                                            <Select value={selectedStorage} onValueChange={setSelectedStorage}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {storages.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    </div>
                                    <div>
                                        <Label className="mb-1.5 block text-sm">{t('compression')}</Label>
                                        <Select value={compress} onValueChange={setCompress}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="zstd">zstd</SelectItem>
                                                <SelectItem value="lzo">lzo</SelectItem>
                                                <SelectItem value="gzip">gzip</SelectItem>
                                                <SelectItem value="none">{t('none')}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <Label className="mb-1.5 block text-sm">{t('backupMode')}</Label>
                                        <Select value={mode} onValueChange={setMode}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="snapshot">{t('modeSnapshot')}</SelectItem>
                                                <SelectItem value="suspend">{t('modeSuspend')}</SelectItem>
                                                <SelectItem value="stop">{t('modeStop')}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <Button onClick={handleBackup} disabled={!selectedStorage || backupRunning}>
                                    <Play className="h-4 w-4 mr-2" />
                                    {t('startBackup')}
                                </Button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="bg-black/90 text-green-400 p-4 rounded-md font-mono text-xs max-h-[250px] overflow-y-auto whitespace-pre-wrap border border-green-900/50 shadow-inner">
                                    {backupLogs.map((log, i) => (
                                        <div key={i} className="mb-1 border-l-2 border-transparent hover:border-green-500/50 pl-2">{log}</div>
                                    ))}
                                    {backupRunning && (
                                        <div className="flex items-center mt-2 text-primary animate-pulse">
                                            <Loader2 className="h-3 w-3 animate-spin mr-2" />
                                            {t('backupInProgress')}
                                        </div>
                                    )}
                                    <div ref={logsEndRef} />
                                </div>
                                {!backupRunning && (
                                    <Button variant="outline" size="sm" onClick={() => setBackupLogs([])}>
                                        {t('newBackup')}
                                    </Button>
                                )}
                            </div>
                        )}
                    </TabsContent>

                    {/* Backup List Tab */}
                    <TabsContent value="list" className="mt-4">
                        {loadingBackups ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : backups.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground text-sm">
                                <Archive className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                <p>{t('noBackups')}</p>
                            </div>
                        ) : (
                            <div className="border rounded-lg overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b bg-muted/50">
                                            <th className="text-left p-2 font-medium">{t('date')}</th>
                                            <th className="text-left p-2 font-medium">{t('storageCol')}</th>
                                            <th className="text-left p-2 font-medium">{t('format')}</th>
                                            <th className="text-right p-2 font-medium">{t('size')}</th>
                                            <th className="text-right p-2 font-medium">{t('actions')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {backups.map((b) => (
                                            <tr key={b.volid} className="border-b last:border-0 hover:bg-muted/30">
                                                <td className="p-2 text-xs">{formatDate(b.ctime)}</td>
                                                <td className="p-2 text-xs font-mono">{b.storage}</td>
                                                <td className="p-2 text-xs">{b.format}</td>
                                                <td className="p-2 text-xs text-right">{formatSize(b.size)}</td>
                                                <td className="p-2 text-right">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 text-xs"
                                                        onClick={() => {
                                                            setRestoreVolid(b.volid);
                                                            // Switch to restore tab by clicking trigger
                                                            const restoreTab = document.querySelector('[data-value="restore"]') as HTMLElement;
                                                            restoreTab?.click();
                                                        }}
                                                    >
                                                        <RotateCcw className="h-3 w-3 mr-1" />
                                                        {t('restore')}
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        <div className="mt-3">
                            <Button variant="outline" size="sm" onClick={loadBackups} disabled={loadingBackups}>
                                {loadingBackups ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
                                {t('refreshList')}
                            </Button>
                        </div>
                    </TabsContent>

                    {/* Restore Tab */}
                    <TabsContent value="restore" className="space-y-4 mt-4">
                        {restoreLogs.length === 0 ? (
                            <div className="space-y-4">
                                <div className="p-3 border rounded-lg bg-amber-500/5 border-amber-200 dark:border-amber-900">
                                    <p className="text-sm text-amber-700 dark:text-amber-400">{t('restoreWarning')}</p>
                                </div>

                                <div>
                                    <Label className="mb-1.5 block text-sm">{t('backupVolume')}</Label>
                                    <Select value={restoreVolid} onValueChange={setRestoreVolid}>
                                        <SelectTrigger><SelectValue placeholder={t('selectBackup')} /></SelectTrigger>
                                        <SelectContent>
                                            {backups.map(b => (
                                                <SelectItem key={b.volid} value={b.volid}>
                                                    {b.volid} ({formatDate(b.ctime)})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label className="mb-1.5 block text-sm">{t('targetVMID')}</Label>
                                        <Input
                                            type="number"
                                            value={restoreVmid}
                                            onChange={(e) => setRestoreVmid(e.target.value)}
                                            placeholder={vm.vmid}
                                        />
                                    </div>
                                    <div>
                                        <Label className="mb-1.5 block text-sm">{t('targetStorage')}</Label>
                                        <Select value={restoreStorage} onValueChange={setRestoreStorage}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {storages.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button disabled={!restoreVolid || !restoreVmid || !restoreStorage || restoring}>
                                            <RotateCcw className="h-4 w-4 mr-2" />
                                            {t('startRestore')}
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>{t('confirmRestore')}</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                {t('restoreConfirmWarning', { vmid: restoreVmid })}
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                                            <AlertDialogAction onClick={handleRestore}>
                                                {t('startRestore')}
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="bg-black/90 text-green-400 p-4 rounded-md font-mono text-xs max-h-[250px] overflow-y-auto whitespace-pre-wrap border border-green-900/50 shadow-inner">
                                    {restoreLogs.map((log, i) => (
                                        <div key={i} className="mb-1 border-l-2 border-transparent hover:border-green-500/50 pl-2">{log}</div>
                                    ))}
                                    {restoring && (
                                        <div className="flex items-center mt-2 text-primary animate-pulse">
                                            <Loader2 className="h-3 w-3 animate-spin mr-2" />
                                            {t('restoreInProgress')}
                                        </div>
                                    )}
                                    <div ref={restoreLogsEndRef} />
                                </div>
                                {!restoring && (
                                    <Button variant="outline" size="sm" onClick={() => setRestoreLogs([])}>
                                        {t('newRestore')}
                                    </Button>
                                )}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('close')}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
