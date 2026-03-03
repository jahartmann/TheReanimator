'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import {
    getAllTasks, getJobs, getJobHistory, createJob, updateJob, deleteJob,
    toggleJob, runJobNow, cancelTask,
    type TaskItem, type JobItem
} from '@/lib/actions/tasks';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
    Loader2, RefreshCw, ListTodo, CheckCircle2, XCircle, StopCircle, Terminal, Search,
    Clock, Activity, ArrowRightLeft, ScanLine, X, Calendar, Plus, Play, Trash2, Pencil,
    ChevronDown, ChevronRight, History
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface TasksClientProps {
    initialJobs: JobItem[];
    servers: { id: number; name: string }[];
}

const CRON_PRESETS = [
    { label: 'everyHour', value: '0 * * * *' },
    { label: 'every6Hours', value: '0 */6 * * *' },
    { label: 'dailyMidnight', value: '0 0 * * *' },
    { label: 'daily3AM', value: '0 3 * * *' },
    { label: 'weekly', value: '0 0 * * 0' },
    { label: 'monthly', value: '0 0 1 * *' },
];

function cronToHuman(schedule: string): string {
    const preset = CRON_PRESETS.find(p => p.value === schedule);
    if (preset) return preset.label;
    // Check if ISO date
    const d = new Date(schedule);
    if (!isNaN(d.getTime())) return d.toLocaleString();
    return schedule;
}

export function TasksClient({ initialJobs, servers }: TasksClientProps) {
    const t = useTranslations('tasks');
    const tj = useTranslations('jobs');
    const locale = useLocale();

    // ── Scheduled Jobs state ──
    const [jobs, setJobs] = useState<JobItem[]>(initialJobs);
    const [jobDialogOpen, setJobDialogOpen] = useState(false);
    const [editingJob, setEditingJob] = useState<JobItem | null>(null);
    const [jobForm, setJobForm] = useState({ name: '', job_type: 'config', source_server_id: 0, schedule: '0 0 * * *' });
    const [expandedJobId, setExpandedJobId] = useState<number | null>(null);
    const [jobHistoryData, setJobHistoryData] = useState<Record<number, any[]>>({});
    const [savingJob, setSavingJob] = useState(false);

    // ── Task History state ──
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [filteredTasks, setFilteredTasks] = useState<TaskItem[]>([]);
    const [loadingTasks, setLoadingTasks] = useState(true);
    const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
    const selectedTaskIdRef = useRef<string | null>(null);
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterType, setFilterType] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');

    // ── Tab state ──
    const [activeTab, setActiveTab] = useState('jobs');

    useEffect(() => { selectedTaskIdRef.current = selectedTask?.id ?? null; }, [selectedTask]);

    // ── Load Jobs ──
    const refreshJobs = useCallback(async () => {
        const data = await getJobs();
        setJobs(data);
    }, []);

    // ── Load Tasks ──
    const loadTasks = useCallback(async () => {
        const res = await getAllTasks(200);
        setTasks(res.items);
        setLoadingTasks(false);
        if (selectedTaskIdRef.current) {
            const updated = res.items.find((t: TaskItem) => t.id === selectedTaskIdRef.current);
            if (updated) setSelectedTask(updated);
        }
    }, []);

    useEffect(() => {
        if (activeTab === 'history') {
            loadTasks();
            const interval = setInterval(loadTasks, 3000);
            return () => clearInterval(interval);
        }
    }, [activeTab, loadTasks]);

    // ── Filter tasks ──
    useEffect(() => {
        let res = tasks;
        if (filterStatus !== 'all') res = res.filter(t => t.status === filterStatus);
        if (filterType !== 'all') res = res.filter(t => t.type === filterType);
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            res = res.filter(t =>
                t.description?.toLowerCase().includes(q) ||
                t.node?.toLowerCase().includes(q) ||
                t.id.toLowerCase().includes(q)
            );
        }
        setFilteredTasks(res);
    }, [tasks, filterStatus, filterType, searchQuery]);

    // ── Job CRUD handlers ──
    function openCreateDialog() {
        setEditingJob(null);
        setJobForm({ name: '', job_type: 'config', source_server_id: servers[0]?.id || 0, schedule: '0 0 * * *' });
        setJobDialogOpen(true);
    }

    function openEditDialog(job: JobItem) {
        setEditingJob(job);
        setJobForm({
            name: job.name,
            job_type: job.job_type,
            source_server_id: job.source_server_id,
            schedule: job.schedule,
        });
        setJobDialogOpen(true);
    }

    async function handleSaveJob() {
        if (!jobForm.name.trim() || !jobForm.source_server_id) return;
        setSavingJob(true);
        try {
            if (editingJob) {
                const res = await updateJob(editingJob.id, jobForm);
                if (!res.success) throw new Error(res.error);
                toast.success(t('jobUpdated'));
            } else {
                const res = await createJob(jobForm);
                if (!res.success) throw new Error(res.error);
                toast.success(t('jobCreated'));
            }
            setJobDialogOpen(false);
            await refreshJobs();
        } catch (e) {
            toast.error(String(e));
        } finally {
            setSavingJob(false);
        }
    }

    async function handleDeleteJob(id: number) {
        if (!confirm(tj('deleteConfirm'))) return;
        const res = await deleteJob(id);
        if (res.success) {
            toast.success(tj('taskDeleted'));
            await refreshJobs();
        } else {
            toast.error(res.error || tj('deleteError'));
        }
    }

    async function handleToggleJob(id: number, enabled: boolean) {
        await toggleJob(id, enabled);
        await refreshJobs();
    }

    async function handleRunNow(id: number) {
        if (!confirm(tj('runNowConfirm'))) return;
        const res = await runJobNow(id);
        if (res.success) {
            toast.success(tj('taskStarted'));
        } else {
            toast.error(res.error || tj('unknownError'));
        }
    }

    async function toggleJobHistory(jobId: number) {
        if (expandedJobId === jobId) {
            setExpandedJobId(null);
            return;
        }
        setExpandedJobId(jobId);
        if (!jobHistoryData[jobId]) {
            const history = await getJobHistory(jobId, 10);
            setJobHistoryData(prev => ({ ...prev, [jobId]: history }));
        }
    }

    // ── Task helpers ──
    async function handleStopTask(task: TaskItem) {
        if (!confirm(t('stopConfirm', { description: task.description }))) return;
        try {
            await cancelTask(task.id);
            toast.success(t('stopSignalSent'));
            loadTasks();
        } catch {
            toast.error(t('stopError'));
        }
    }

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'running': return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
            case 'completed':
            case 'success': return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
            case 'failed': return <XCircle className="h-3.5 w-3.5 text-red-500" />;
            case 'cancelled': return <StopCircle className="h-3.5 w-3.5 text-orange-500" />;
            case 'pending': return <Clock className="h-3.5 w-3.5 text-amber-500" />;
            case 'skipped': return <Clock className="h-3.5 w-3.5 text-gray-400" />;
            default: return <Activity className="h-3.5 w-3.5 text-muted-foreground" />;
        }
    };

    const getStatusText = (status: string): string => {
        const map: Record<string, string> = {
            running: t('statusRunning'), completed: t('statusCompleted'),
            success: t('statusSuccess'), failed: t('statusFailed'),
            cancelled: t('statusCancelled'), pending: t('statusPending'),
        };
        return map[status] || status;
    };

    const getTypeBadge = (type: string) => {
        const colors: Record<string, string> = {
            config: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
            scan: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
            migration: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
            network_analysis: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
        };
        return (
            <Badge variant="outline" className={cn('text-[10px] uppercase font-medium', colors[type] || '')}>
                {type}
            </Badge>
        );
    };

    const getTypeText = (type: string): string => {
        const map: Record<string, string> = {
            scan: t('typeScan'), migration: t('typeMigration'),
            background: t('typeBackground'), config: t('typeConfig'),
        };
        return map[type] || type;
    };

    const getCronLabel = (schedule: string): string => {
        const preset = CRON_PRESETS.find(p => p.value === schedule);
        if (preset) return t(`cron_${preset.label}` as any);
        const d = new Date(schedule);
        if (!isNaN(d.getTime())) return d.toLocaleString(locale);
        return schedule;
    };

    const runningCount = tasks.filter(t => t.status === 'running').length;

    return (
        <div className="h-[calc(100vh-2rem)] flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <div className="bg-primary/10 p-2.5 rounded-xl">
                        <ListTodo className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{t('taskCenter')}</h1>
                        <p className="text-sm text-muted-foreground">{t('description')}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {runningCount > 0 && (
                        <div className="flex items-center gap-1.5 text-sm mr-2">
                            <span className="h-2 w-2 bg-blue-500 rounded-full animate-pulse" />
                            <span className="font-medium text-blue-600">{runningCount} {t('active')}</span>
                        </div>
                    )}
                    <Button variant="outline" size="sm" onClick={() => activeTab === 'jobs' ? refreshJobs() : loadTasks()}>
                        <RefreshCw className="mr-2 h-3.5 w-3.5" />
                        {t('refresh')}
                    </Button>
                </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
                <TabsList className="shrink-0">
                    <TabsTrigger value="jobs" className="gap-2">
                        <Calendar className="h-3.5 w-3.5" />
                        {t('scheduledJobs')}
                    </TabsTrigger>
                    <TabsTrigger value="history" className="gap-2">
                        <History className="h-3.5 w-3.5" />
                        {t('taskHistory')}
                    </TabsTrigger>
                </TabsList>

                {/* ══════════════ SCHEDULED JOBS TAB ══════════════ */}
                <TabsContent value="jobs" className="flex-1 flex flex-col min-h-0 mt-4">
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-sm text-muted-foreground">
                            {t('scheduledJobsDesc', { count: jobs.length })}
                        </p>
                        <Button size="sm" onClick={openCreateDialog}>
                            <Plus className="mr-2 h-3.5 w-3.5" />
                            {t('createJob')}
                        </Button>
                    </div>

                    <ScrollArea className="flex-1 rounded-lg border bg-card">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-8"></TableHead>
                                    <TableHead>{t('colName')}</TableHead>
                                    <TableHead>{t('colType')}</TableHead>
                                    <TableHead>{t('colServer')}</TableHead>
                                    <TableHead>{t('colSchedule')}</TableHead>
                                    <TableHead>{t('colLastRun')}</TableHead>
                                    <TableHead>{t('colStatus')}</TableHead>
                                    <TableHead>{t('colEnabled')}</TableHead>
                                    <TableHead className="text-right">{t('colActions')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {jobs.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                                            <Calendar className="h-8 w-8 mx-auto mb-2 opacity-20" />
                                            <p>{t('noJobs')}</p>
                                        </TableCell>
                                    </TableRow>
                                ) : jobs.map(job => (
                                    <Fragment key={job.id}>
                                        <TableRow className="group">
                                            <TableCell>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6"
                                                    onClick={() => toggleJobHistory(job.id)}
                                                >
                                                    {expandedJobId === job.id
                                                        ? <ChevronDown className="h-3.5 w-3.5" />
                                                        : <ChevronRight className="h-3.5 w-3.5" />}
                                                </Button>
                                            </TableCell>
                                            <TableCell className="font-medium">{job.name}</TableCell>
                                            <TableCell>{getTypeBadge(job.job_type)}</TableCell>
                                            <TableCell className="text-sm">{job.server_name || '-'}</TableCell>
                                            <TableCell>
                                                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                                                    {getCronLabel(job.schedule)}
                                                </code>
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {job.last_run
                                                    ? new Date(job.last_run).toLocaleString(locale, {
                                                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                                                    })
                                                    : '-'}
                                            </TableCell>
                                            <TableCell>
                                                {job.last_status ? (
                                                    <div className="flex items-center gap-1.5">
                                                        {getStatusIcon(job.last_status)}
                                                        <span className="text-xs">{getStatusText(job.last_status)}</span>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <Switch
                                                    checked={job.enabled === 1}
                                                    onCheckedChange={(checked) => handleToggleJob(job.id, checked)}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRunNow(job.id)} title={tj('runNow')}>
                                                        <Play className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog(job)}>
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => handleDeleteJob(job.id)}>
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>

                                        {/* Expanded History */}
                                        {expandedJobId === job.id && (
                                            <TableRow key={`history-${job.id}`}>
                                                <TableCell colSpan={9} className="bg-muted/30 px-6 py-3">
                                                    <p className="text-xs font-medium mb-2 text-muted-foreground">{t('recentRuns')}</p>
                                                    {!jobHistoryData[job.id] ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : jobHistoryData[job.id].length === 0 ? (
                                                        <p className="text-xs text-muted-foreground">{t('noHistory')}</p>
                                                    ) : (
                                                        <div className="space-y-1">
                                                            {jobHistoryData[job.id].map((h: any) => {
                                                                let duration = '-';
                                                                if (h.start_time && h.end_time) {
                                                                    const ms = new Date(h.end_time).getTime() - new Date(h.start_time).getTime();
                                                                    if (ms < 1000) duration = `${ms}ms`;
                                                                    else if (ms < 60000) duration = `${Math.round(ms / 1000)}s`;
                                                                    else duration = `${Math.round(ms / 60000)}m`;
                                                                }
                                                                return (
                                                                    <div key={h.id} className="flex items-center gap-3 text-xs py-1">
                                                                        {getStatusIcon(h.status)}
                                                                        <span className="text-muted-foreground w-32">
                                                                            {new Date(h.start_time).toLocaleString(locale, {
                                                                                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                                                                            })}
                                                                        </span>
                                                                        <span className="w-16">{duration}</span>
                                                                        <span className="truncate flex-1 text-muted-foreground font-mono text-[10px]">
                                                                            {h.log ? h.log.slice(0, 120) : '-'}
                                                                        </span>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </Fragment>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </TabsContent>

                {/* ══════════════ TASK HISTORY TAB ══════════════ */}
                <TabsContent value="history" className="flex-1 flex flex-col min-h-0 mt-4">
                    {/* Filters */}
                    <div className="flex gap-2 shrink-0 mb-3">
                        <div className="relative flex-1 max-w-sm">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder={t('searchPlaceholder')}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 h-9"
                            />
                            {searchQuery && (
                                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                                    <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                                </button>
                            )}
                        </div>
                        <Select value={filterType} onValueChange={setFilterType}>
                            <SelectTrigger className="w-[140px] h-9">
                                <SelectValue placeholder={t('taskType')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('allTypes')}</SelectItem>
                                <SelectItem value="scan">{t('typeScan')}</SelectItem>
                                <SelectItem value="migration">{t('typeMigration')}</SelectItem>
                                <SelectItem value="background">{t('typeBackground')}</SelectItem>
                                <SelectItem value="config">{t('typeConfig')}</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={filterStatus} onValueChange={setFilterStatus}>
                            <SelectTrigger className="w-[140px] h-9">
                                <SelectValue placeholder={t('status')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                                <SelectItem value="running">{t('statusRunning')}</SelectItem>
                                <SelectItem value="completed">{t('statusCompleted')}</SelectItem>
                                <SelectItem value="failed">{t('statusFailed')}</SelectItem>
                                <SelectItem value="cancelled">{t('statusCancelled')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Task list + detail */}
                    <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
                        <div className={cn('flex flex-col transition-all duration-300 min-h-0', selectedTask ? 'w-[55%]' : 'w-full')}>
                            <div className="flex items-center justify-between px-1 pb-2">
                                <span className="text-xs text-muted-foreground font-medium">
                                    {filteredTasks.length} {t('tasks')}
                                </span>
                            </div>
                            <ScrollArea className="flex-1 rounded-lg border bg-card">
                                <div className="divide-y">
                                    {loadingTasks && filteredTasks.length === 0 ? (
                                        <div className="flex justify-center py-20">
                                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                        </div>
                                    ) : filteredTasks.length === 0 ? (
                                        <div className="text-center py-20 text-muted-foreground">
                                            <ListTodo className="h-10 w-10 mx-auto mb-3 opacity-20" />
                                            <p className="text-sm">{t('noTasksFound')}</p>
                                        </div>
                                    ) : (
                                        filteredTasks.map(task => (
                                            <div
                                                key={task.id}
                                                className={cn(
                                                    'flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors group',
                                                    selectedTask?.id === task.id
                                                        ? 'bg-primary/5 border-l-2 border-l-primary'
                                                        : 'hover:bg-muted/50 border-l-2 border-l-transparent'
                                                )}
                                                onClick={() => setSelectedTask(task)}
                                            >
                                                <div className="shrink-0">{getStatusIcon(task.status)}</div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium truncate">{task.description || task.id}</span>
                                                        <Badge variant="outline" className="text-[9px] uppercase px-1.5 py-0 shrink-0">
                                                            {getTypeText(task.type)}
                                                        </Badge>
                                                    </div>
                                                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                                                        {task.node && <span>{task.node}</span>}
                                                        <span>
                                                            {new Date(task.startTime).toLocaleString(locale, {
                                                                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                                                            })}
                                                        </span>
                                                        {task.duration && <span>{task.duration}</span>}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <Badge variant={
                                                        task.status === 'failed' ? 'destructive' :
                                                            task.status === 'running' ? 'default' :
                                                                task.status === 'cancelled' ? 'secondary' : 'outline'
                                                    } className="text-[10px]">
                                                        {getStatusText(task.status)}
                                                    </Badge>
                                                    {task.status === 'running' && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6 text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100"
                                                            onClick={(e) => { e.stopPropagation(); handleStopTask(task); }}
                                                        >
                                                            <StopCircle className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </ScrollArea>
                        </div>

                        {/* Detail Panel */}
                        {selectedTask && (
                            <Card className="w-[45%] flex flex-col animate-in slide-in-from-right-5 duration-300 overflow-hidden">
                                <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20 shrink-0">
                                    <div className="flex items-center gap-2 min-w-0">
                                        {getStatusIcon(selectedTask.status)}
                                        <span className="font-medium text-sm truncate">{selectedTask.description}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        {selectedTask.status === 'running' && (
                                            <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={() => handleStopTask(selectedTask)}>
                                                <StopCircle className="mr-1 h-3 w-3" />
                                                {t('stop')}
                                            </Button>
                                        )}
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedTask(null)}>
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-3 p-3 border-b text-xs shrink-0">
                                    <div>
                                        <p className="text-muted-foreground mb-0.5">{t('type')}</p>
                                        <p className="font-medium">{getTypeText(selectedTask.type)}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground mb-0.5">{t('node')}</p>
                                        <p className="font-medium">{selectedTask.node || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground mb-0.5">{t('duration')}</p>
                                        <p className="font-medium">{selectedTask.duration || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground mb-0.5">{t('start')}</p>
                                        <p className="font-medium">{new Date(selectedTask.startTime).toLocaleString(locale)}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground mb-0.5">{t('end')}</p>
                                        <p className="font-medium">{selectedTask.endTime ? new Date(selectedTask.endTime).toLocaleString(locale) : '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground mb-0.5">ID</p>
                                        <p className="font-mono text-[10px] truncate" title={selectedTask.id}>{selectedTask.id}</p>
                                    </div>
                                </div>
                                <div className="flex-1 bg-[#0c0c0c] overflow-hidden flex flex-col min-h-0">
                                    <div className="px-3 py-2 border-b border-zinc-800 text-xs text-zinc-500 flex items-center justify-between shrink-0">
                                        <div className="flex items-center gap-2">
                                            <Terminal className="h-3 w-3" />
                                            <span>{t('logOutput')}</span>
                                        </div>
                                        {selectedTask.status === 'running' && (
                                            <span className="flex items-center gap-1.5 text-green-400">
                                                <span className="h-1.5 w-1.5 bg-green-400 rounded-full animate-pulse" />
                                                {t('live')}
                                            </span>
                                        )}
                                    </div>
                                    <ScrollArea className="flex-1">
                                        <pre className="p-4 font-mono text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed select-text">
                                            {selectedTask.log || <span className="text-zinc-600 italic">{t('waitingForLogs')}</span>}
                                            {selectedTask.status === 'running' && <span className="animate-pulse ml-0.5 text-zinc-500">|</span>}
                                        </pre>
                                    </ScrollArea>
                                </div>
                            </Card>
                        )}
                    </div>
                </TabsContent>
            </Tabs>

            {/* ══════════════ CREATE / EDIT JOB DIALOG ══════════════ */}
            <Dialog open={jobDialogOpen} onOpenChange={setJobDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingJob ? t('editJob') : t('createJob')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>{t('colName')}</Label>
                            <Input
                                value={jobForm.name}
                                onChange={e => setJobForm(p => ({ ...p, name: e.target.value }))}
                                placeholder={t('jobNamePlaceholder')}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>{t('colType')}</Label>
                            <Select value={jobForm.job_type} onValueChange={v => setJobForm(p => ({ ...p, job_type: v }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="config">Config Backup</SelectItem>
                                    <SelectItem value="scan">Health Scan</SelectItem>
                                    <SelectItem value="migration">Migration</SelectItem>
                                    <SelectItem value="network_analysis">Network Analysis</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>{t('colServer')}</Label>
                            <Select
                                value={String(jobForm.source_server_id)}
                                onValueChange={v => setJobForm(p => ({ ...p, source_server_id: Number(v) }))}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {servers.map(s => (
                                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>{t('colSchedule')}</Label>
                            <div className="flex flex-wrap gap-1.5 mb-2">
                                {CRON_PRESETS.map(preset => (
                                    <Button
                                        key={preset.value}
                                        variant={jobForm.schedule === preset.value ? 'default' : 'outline'}
                                        size="sm"
                                        className="text-xs h-7"
                                        onClick={() => setJobForm(p => ({ ...p, schedule: preset.value }))}
                                    >
                                        {t(`cron_${preset.label}` as any)}
                                    </Button>
                                ))}
                            </div>
                            <Input
                                value={jobForm.schedule}
                                onChange={e => setJobForm(p => ({ ...p, schedule: e.target.value }))}
                                placeholder="0 * * * *"
                                className="font-mono text-sm"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setJobDialogOpen(false)}>{t('cancel')}</Button>
                        <Button onClick={handleSaveJob} disabled={savingJob || !jobForm.name.trim()}>
                            {savingJob && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                            {editingJob ? t('saveChanges') : t('createJob')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
