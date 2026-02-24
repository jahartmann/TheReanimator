'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Clock, Plus, Trash2, ToggleLeft, ToggleRight, Calendar, Loader2 } from "lucide-react";
import {
    getScheduledJobs,
    createConfigBackupSchedule,
    toggleJob,
    deleteScheduledJob,
    ScheduledJob
} from '@/lib/actions/schedule';
import { useTranslations } from 'next-intl';

interface ScheduleManagerProps {
    servers: { id: number; name: string }[];
}

export function ScheduleManager({ servers }: ScheduleManagerProps) {
    const t = useTranslations('scheduleManager');

    const schedulePresets = [
        { label: t('daily2am'), value: '0 2 * * *' },
        { label: t('daily4am'), value: '0 4 * * *' },
        { label: t('weekly'), value: '0 3 * * 0' },
        { label: t('monthly'), value: '0 3 1 * *' },
        { label: t('every6hours'), value: '0 */6 * * *' },
        { label: t('every12hours'), value: '0 */12 * * *' },
    ];

    const [jobs, setJobs] = useState<ScheduledJob[]>([]);
    const [loading, setLoading] = useState(true);
    const [showDialog, setShowDialog] = useState(false);
    const [selectedServer, setSelectedServer] = useState<string>('');
    const [selectedSchedule, setSelectedSchedule] = useState<string>('0 2 * * *');
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        fetchJobs();
    }, []);

    async function fetchJobs() {
        try {
            const data = await getScheduledJobs();
            setJobs(data.filter(j => j.job_type === 'config'));
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleCreate() {
        if (!selectedServer) return;

        setCreating(true);
        try {
            const result = await createConfigBackupSchedule(parseInt(selectedServer), selectedSchedule);
            if (result.success) {
                setShowDialog(false);
                setSelectedServer('');
                fetchJobs();
            } else {
                alert(result.error);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setCreating(false);
        }
    }

    async function handleToggle(jobId: number) {
        await toggleJob(jobId);
        fetchJobs();
    }

    async function handleDelete(jobId: number) {
        if (!confirm(t('confirmDelete'))) return;
        await deleteScheduledJob(jobId);
        fetchJobs();
    }

    const getScheduleLabel = (cron: string) => {
        const preset = schedulePresets.find(p => p.value === cron);
        return preset?.label || cron;
    };

    // Filter servers that don't have a job yet
    const availableServers = servers.filter(s => !jobs.some(j => j.source_server_id === s.id));

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    {t('title')}
                </CardTitle>
                <Button size="sm" onClick={() => setShowDialog(true)} disabled={availableServers.length === 0}>
                    <Plus className="h-4 w-4 mr-2" />
                    {t('addSchedule')}
                </Button>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : jobs.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                        <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>{t('noSchedules')}</p>
                        <p className="text-sm mt-1">{t('createSchedule')}</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {jobs.map(job => (
                            <div
                                key={job.id}
                                className="flex items-center justify-between p-3 rounded-lg border bg-card"
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${job.enabled ? 'bg-green-500/10' : 'bg-muted'
                                        }`}>
                                        <Clock className={`h-5 w-5 ${job.enabled ? 'text-green-500' : 'text-muted-foreground'
                                            }`} />
                                    </div>
                                    <div>
                                        <p className="font-medium">{job.server_name}</p>
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <span>{getScheduleLabel(job.schedule)}</span>
                                            <Badge variant={job.enabled ? 'default' : 'secondary'} className="text-xs">
                                                {job.enabled ? t('active') : t('paused')}
                                            </Badge>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleToggle(job.id)}
                                        title={job.enabled ? t('deactivate') : t('activate')}
                                    >
                                        {job.enabled ? (
                                            <ToggleRight className="h-5 w-5 text-green-500" />
                                        ) : (
                                            <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                                        )}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleDelete(job.id)}
                                        className="text-red-500 hover:text-red-600"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>

            {/* Create Dialog */}
            <Dialog open={showDialog} onOpenChange={setShowDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('dialogTitle')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <Label>{t('server')}</Label>
                            <Select value={selectedServer} onValueChange={setSelectedServer}>
                                <SelectTrigger className="mt-2">
                                    <SelectValue placeholder={t('selectServer')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableServers.map(s => (
                                        <SelectItem key={s.id} value={s.id.toString()}>
                                            {s.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>{t('schedule')}</Label>
                            <Select value={selectedSchedule} onValueChange={setSelectedSchedule}>
                                <SelectTrigger className="mt-2">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {schedulePresets.map(p => (
                                        <SelectItem key={p.value} value={p.value}>
                                            {p.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowDialog(false)}>{t('cancel')}</Button>
                        <Button onClick={handleCreate} disabled={!selectedServer || creating}>
                            {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                            {t('create')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
