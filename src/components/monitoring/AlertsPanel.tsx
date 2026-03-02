'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Bell, BellOff, Plus, Trash2, Loader2, AlertTriangle, AlertCircle, CheckCircle, Clock, Settings } from 'lucide-react';
import { toast } from 'sonner';
import {
    getAlertChecks,
    createAlertCheck,
    toggleAlertCheck,
    deleteAlertCheck,
    silenceAlert,
    unsilenceAlert,
    getMonitoringInterval,
    updateMonitoringInterval,
    getServersForAlerts,
    getVMsForAlerts,
    type AlertCheck,
} from '@/lib/actions/alerts';

export function AlertsPanel() {
    const t = useTranslations('monitoring');
    const [checks, setChecks] = useState<AlertCheck[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [pollingInterval, setPollingInterval] = useState(5);

    // Silence dialog
    const [silenceCheckId, setSilenceCheckId] = useState<number | null>(null);
    const [silenceDuration, setSilenceDuration] = useState('60');
    const [silenceReason, setSilenceReason] = useState('');

    // Create form
    const [createName, setCreateName] = useState('');
    const [createType, setCreateType] = useState('vm_resource');
    const [createServerId, setCreateServerId] = useState('');
    const [createVmId, setCreateVmId] = useState('');
    const [createInterval, setCreateInterval] = useState('5');
    const [createWarning, setCreateWarning] = useState('80');
    const [createCritical, setCreateCritical] = useState('95');
    const [createMode, setCreateMode] = useState('on_change');
    const [servers, setServers] = useState<{ id: number; name: string }[]>([]);
    const [vms, setVms] = useState<{ vmid: string; name: string; type: string }[]>([]);
    const [creating, setCreating] = useState(false);

    const loadData = async () => {
        setLoading(true);
        try {
            const [checksData, interval] = await Promise.all([
                getAlertChecks(),
                getMonitoringInterval(),
            ]);
            setChecks(checksData);
            setPollingInterval(interval);
        } catch {
            toast.error(t('alertsLoadFailed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, []);

    const handleToggle = async (checkId: number, enabled: boolean) => {
        await toggleAlertCheck(checkId, enabled);
        setChecks(prev => prev.map(c => c.id === checkId ? { ...c, enabled: enabled ? 1 : 0 } : c));
    };

    const handleDelete = async (checkId: number) => {
        await deleteAlertCheck(checkId);
        setChecks(prev => prev.filter(c => c.id !== checkId));
        toast.success(t('alertDeleted'));
    };

    const handleSilence = async () => {
        if (!silenceCheckId) return;
        const res = await silenceAlert(silenceCheckId, parseInt(silenceDuration), silenceReason || undefined);
        if (res.success) {
            toast.success(res.message);
            setSilenceCheckId(null);
            setSilenceReason('');
            await loadData();
        } else {
            toast.error(res.message);
        }
    };

    const handleUnsilence = async (checkId: number) => {
        await unsilenceAlert(checkId);
        await loadData();
        toast.success(t('alertUnsilenced'));
    };

    const handleCreate = async () => {
        if (!createName.trim()) return;
        setCreating(true);
        try {
            const needsVM = ['vm_resource', 'vm_status'].includes(createType);
            const res = await createAlertCheck({
                name: createName.trim(),
                checkType: createType,
                serverId: createServerId ? parseInt(createServerId) : undefined,
                vmId: needsVM && createVmId ? parseInt(createVmId) : undefined,
                intervalMinutes: parseInt(createInterval),
                thresholdWarning: { value: parseInt(createWarning) },
                thresholdCritical: { value: parseInt(createCritical) },
                notificationMode: createMode,
            });
            if (res.success) {
                toast.success(t('alertCreated'));
                setShowCreate(false);
                setCreateName('');
                await loadData();
            } else {
                toast.error(res.message);
            }
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setCreating(false);
        }
    };

    const handleSaveInterval = async () => {
        await updateMonitoringInterval(pollingInterval);
        toast.success(t('intervalSaved'));
        setShowSettings(false);
    };

    // Load servers for create dialog
    useEffect(() => {
        if (showCreate) {
            getServersForAlerts().then(setServers).catch(() => { });
        }
    }, [showCreate]);

    // Load VMs when server changes
    useEffect(() => {
        if (createServerId) {
            getVMsForAlerts(parseInt(createServerId)).then(setVms).catch(() => setVms([]));
        } else {
            setVms([]);
        }
    }, [createServerId]);

    const statusIcon = (status: string) => {
        switch (status) {
            case 'ok': return <CheckCircle className="h-4 w-4 text-green-500" />;
            case 'warning': return <AlertTriangle className="h-4 w-4 text-amber-500" />;
            case 'critical': return <AlertCircle className="h-4 w-4 text-red-500" />;
            default: return <Clock className="h-4 w-4 text-muted-foreground" />;
        }
    };

    const statusBadge = (status: string) => {
        const colors: Record<string, string> = {
            ok: 'bg-green-500/10 text-green-600 border-green-200',
            warning: 'bg-amber-500/10 text-amber-600 border-amber-200',
            critical: 'bg-red-500/10 text-red-600 border-red-200',
            error: 'bg-gray-500/10 text-gray-600 border-gray-200',
            unknown: 'bg-gray-500/10 text-gray-500 border-gray-200',
        };
        return colors[status] || colors.unknown;
    };

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        {t('createAlert')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>
                        <Settings className="h-4 w-4 mr-2" />
                        {t('pollingSettings')}
                    </Button>
                </div>
                <Badge variant="outline" className="text-xs">
                    {checks.length} {t('checksConfigured')}
                </Badge>
            </div>

            {/* Alert Checks List */}
            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
            ) : checks.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground text-sm">
                        <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>{t('noAlerts')}</p>
                        <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowCreate(true)}>
                            <Plus className="h-4 w-4 mr-2" /> {t('createFirstAlert')}
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-2">
                    {checks.map(check => (
                        <Card key={check.id} className={check.silenced_until ? 'opacity-60' : ''}>
                            <CardContent className="py-3 px-4">
                                <div className="flex items-center gap-3">
                                    {statusIcon(check.last_status)}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-sm truncate">{check.name}</span>
                                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusBadge(check.last_status)}`}>
                                                {check.last_status}
                                            </Badge>
                                            {check.silenced_until && (
                                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-muted">
                                                    <BellOff className="h-2.5 w-2.5 mr-1" />
                                                    {t('silenced')}
                                                </Badge>
                                            )}
                                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                                {check.check_type}
                                            </Badge>
                                        </div>
                                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                                            {check.last_message || t('noDataYet')}
                                            {check.server_name && ` — ${check.server_name}`}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {check.consecutive_failures > 0 && (
                                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                                {check.consecutive_failures}x
                                            </Badge>
                                        )}
                                        {check.silenced_until ? (
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleUnsilence(check.id)} title={t('unsilence')}>
                                                <Bell className="h-3.5 w-3.5" />
                                            </Button>
                                        ) : (
                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-500" onClick={() => setSilenceCheckId(check.id)} title={t('silence')}>
                                                <BellOff className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                        <Switch
                                            checked={!!check.enabled}
                                            onCheckedChange={(v) => handleToggle(check.id, v)}
                                            className="scale-75"
                                        />
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => handleDelete(check.id)}>
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Silence Dialog */}
            <Dialog open={!!silenceCheckId} onOpenChange={(open) => !open && setSilenceCheckId(null)}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <BellOff className="h-5 w-5" />
                            {t('silenceAlert')}
                        </DialogTitle>
                        <DialogDescription>{t('silenceDescription')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div>
                            <Label className="mb-1.5 block text-sm">{t('duration')}</Label>
                            <Select value={silenceDuration} onValueChange={setSilenceDuration}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="15">15 {t('minutes')}</SelectItem>
                                    <SelectItem value="30">30 {t('minutes')}</SelectItem>
                                    <SelectItem value="60">1 {t('hour')}</SelectItem>
                                    <SelectItem value="120">2 {t('hours')}</SelectItem>
                                    <SelectItem value="240">4 {t('hours')}</SelectItem>
                                    <SelectItem value="480">8 {t('hours')}</SelectItem>
                                    <SelectItem value="1440">24 {t('hours')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label className="mb-1.5 block text-sm">{t('reason')}</Label>
                            <Input
                                value={silenceReason}
                                onChange={(e) => setSilenceReason(e.target.value)}
                                placeholder={t('reasonPlaceholder')}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setSilenceCheckId(null)}>{t('cancel')}</Button>
                        <Button onClick={handleSilence}>{t('silence')}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Create Alert Dialog */}
            <Dialog open={showCreate} onOpenChange={setShowCreate}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Plus className="h-5 w-5" />
                            {t('createAlert')}
                        </DialogTitle>
                        <DialogDescription>{t('createAlertDescription')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div>
                            <Label className="mb-1.5 block text-sm">{t('alertName')}</Label>
                            <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder={t('alertNamePlaceholder')} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label className="mb-1.5 block text-sm">{t('checkType')}</Label>
                                <Select value={createType} onValueChange={setCreateType}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="vm_resource">{t('typeVMResource')}</SelectItem>
                                        <SelectItem value="cpu">{t('typeCPU')}</SelectItem>
                                        <SelectItem value="ram">{t('typeRAM')}</SelectItem>
                                        <SelectItem value="storage">{t('typeStorage')}</SelectItem>
                                        <SelectItem value="vm_status">{t('typeVMStatus')}</SelectItem>
                                        <SelectItem value="backup_health">{t('typeBackupHealth')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label className="mb-1.5 block text-sm">{t('server')}</Label>
                                <Select value={createServerId} onValueChange={setCreateServerId}>
                                    <SelectTrigger><SelectValue placeholder={t('selectServer')} /></SelectTrigger>
                                    <SelectContent>
                                        {servers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        {['vm_resource', 'vm_status'].includes(createType) && createServerId && (
                            <div>
                                <Label className="mb-1.5 block text-sm">{t('vm')}</Label>
                                <Select value={createVmId} onValueChange={setCreateVmId}>
                                    <SelectTrigger><SelectValue placeholder={t('selectVM')} /></SelectTrigger>
                                    <SelectContent>
                                        {vms.map(v => <SelectItem key={v.vmid} value={v.vmid}>{v.vmid} — {v.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <Label className="mb-1.5 block text-sm">{t('interval')}</Label>
                                <Select value={createInterval} onValueChange={setCreateInterval}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="1">1 min</SelectItem>
                                        <SelectItem value="2">2 min</SelectItem>
                                        <SelectItem value="5">5 min</SelectItem>
                                        <SelectItem value="10">10 min</SelectItem>
                                        <SelectItem value="15">15 min</SelectItem>
                                        <SelectItem value="30">30 min</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label className="mb-1.5 block text-sm">{t('warningAt')}</Label>
                                <Input type="number" value={createWarning} onChange={(e) => setCreateWarning(e.target.value)} />
                            </div>
                            <div>
                                <Label className="mb-1.5 block text-sm">{t('criticalAt')}</Label>
                                <Input type="number" value={createCritical} onChange={(e) => setCreateCritical(e.target.value)} />
                            </div>
                        </div>
                        <div>
                            <Label className="mb-1.5 block text-sm">{t('notificationMode')}</Label>
                            <Select value={createMode} onValueChange={setCreateMode}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="on_change">{t('modeOnChange')}</SelectItem>
                                    <SelectItem value="always">{t('modeAlways')}</SelectItem>
                                    <SelectItem value="escalation">{t('modeEscalation')}</SelectItem>
                                    <SelectItem value="digest">{t('modeDigest')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setShowCreate(false)}>{t('cancel')}</Button>
                        <Button onClick={handleCreate} disabled={!createName.trim() || creating}>
                            {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                            {t('create')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Polling Settings Dialog */}
            <Dialog open={showSettings} onOpenChange={setShowSettings}>
                <DialogContent className="sm:max-w-[350px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Settings className="h-5 w-5" />
                            {t('pollingSettings')}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div>
                            <Label className="mb-1.5 block text-sm">{t('nodeStatsInterval')}</Label>
                            <Select value={String(pollingInterval)} onValueChange={(v) => setPollingInterval(parseInt(v))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="1">1 {t('minutes')}</SelectItem>
                                    <SelectItem value="2">2 {t('minutes')}</SelectItem>
                                    <SelectItem value="5">5 {t('minutes')}</SelectItem>
                                    <SelectItem value="10">10 {t('minutes')}</SelectItem>
                                    <SelectItem value="15">15 {t('minutes')}</SelectItem>
                                    <SelectItem value="30">30 {t('minutes')}</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground mt-1">{t('intervalNote')}</p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setShowSettings(false)}>{t('cancel')}</Button>
                        <Button onClick={handleSaveInterval}>{t('save')}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
