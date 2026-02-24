'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, ArrowRightLeft, CheckCircle2, XCircle, MoreVertical, Trash2, Play, ChevronLeft, ChevronRight } from 'lucide-react';
import { getAllTasks, TaskItem, PaginatedTasks } from '@/lib/actions/tasks';
import { getAllJobs, runJob, deleteJob } from '@/lib/actions/scheduler_actions';
import { toast } from 'sonner';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatDistanceToNow } from 'date-fns';
import { dateFnsLocale } from '@/lib/date-utils';

interface Job {
    id: number;
    name: string;
    job_type: string;
    schedule: string;
    enabled: boolean;
    last_run?: string;
    next_run?: string; // Calculated
    options?: string;
}

export default function JobsPage() {
    const t = useTranslations('jobs');
    const tCommon = useTranslations('common');
    const locale = useLocale();
    const [jobs, setJobs] = useState<Job[]>([]);
    const [history, setHistory] = useState<TaskItem[]>([]);
    const [loading, setLoading] = useState(true);

    // Pagination state
    const [historyPage, setHistoryPage] = useState(0);
    const [historyTotal, setHistoryTotal] = useState(0);
    const historyPageSize = 20;

    // Helper function to format schedule display
    const formatSchedule = (schedule: string): string => {
        if (schedule === '@manual') return t('manual');
        return schedule;
    };

    // Helper function to format status display
    const formatStatus = (status: string): string => {
        const statusMap: Record<string, string> = {
            'success': t('statusSuccess'),
            'failed': t('statusFailed'),
            'running': t('statusRunning'),
            'completed': t('statusCompleted'),
            'cancelled': t('statusCancelled')
        };
        return statusMap[status] || status;
    };

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 5000);
        return () => clearInterval(interval);
    }, [historyPage]);

    async function loadData() {
        try {
            // Parallel fetch
            const [fetchedJobs, fetchedHistory] = await Promise.all([
                getAllJobs(),
                getAllTasks(historyPageSize, historyPage * historyPageSize)
            ]);
            setJobs(fetchedJobs);
            setHistory(fetchedHistory.items);
            setHistoryTotal(fetchedHistory.total);
        } catch (e) {
            console.error("Failed to load jobs", e);
        } finally {
            setLoading(false);
        }
    }

    const historyTotalPages = Math.ceil(historyTotal / historyPageSize);
    const canHistoryPrev = historyPage > 0;
    const canHistoryNext = historyPage < historyTotalPages - 1;

    async function handleRunNow(id: number) {
        if (!confirm(t('runNowConfirm'))) return;
        try {
            const result = await runJob(id);
            if (result.success) {
                toast.success(t('taskStarted'));
            } else {
                toast.error(t('error') + ": " + (result.error || t('unknownError')));
            }
            loadData();
        } catch (e: any) {
            toast.error(t('error') + ": " + e.message);
        }
    }

    async function handleDelete(id: number) {
        if (!confirm(t('deleteConfirm'))) return;
        try {
            await deleteJob(id);
            toast.success(t('taskDeleted'));
            loadData();
        } catch (e: any) {
            toast.error(t('deleteError') + ": " + e.message);
        }
    }

    return (
        <div className="container mx-auto py-8 space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold">{t('title')}</h1>
                    <p className="text-muted-foreground">{t('subtitle')}</p>
                </div>
            </div>

            {/* Scheduled Jobs Section */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Calendar className="h-5 w-5" /> {t('scheduledJobs')}</CardTitle>
                    <CardDescription>{t('scheduledJobsDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                    {jobs.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                            {t('noScheduledTasks')}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {jobs.map(job => (
                                <div key={job.id} className="flex items-center justify-between p-4 border rounded-lg bg-card hover:bg-muted/50 transition-colors">
                                    <div className="flex items-center gap-4">
                                        <div className="p-2 bg-primary/10 rounded-full text-primary">
                                            {job.job_type === 'migration' ? <ArrowRightLeft className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
                                        </div>
                                        <div>
                                            <div className="font-semibold">{job.name}</div>
                                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                                <Badge variant="outline" className="font-mono">{formatSchedule(job.schedule)}</Badge>
                                                {job.last_run && <span>{t('lastRun')}: {new Date(job.last_run).toLocaleString(locale)}</span>}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="font-medium text-green-600">{t('active')}</div>
                                        {job.next_run && (
                                            <div className="text-xs text-muted-foreground mt-1">
                                                {t('nextRun')}: {job.next_run === 'Manual' || job.next_run === 'Invalid Schedule' ? job.next_run : new Date(job.next_run).toLocaleString(locale)}
                                            </div>
                                        )}
                                    </div>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => handleRunNow(job.id)}><Play className="h-4 w-4 mr-2" /> {t('runNow')}</DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(job.id)}><Trash2 className="h-4 w-4 mr-2" /> {tCommon('delete')}</DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                    ))}
                </div>
                    )}
            </CardContent>
        </Card>

            {/* History Section */ }
    <Card>
        <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> {t('history')}</CardTitle>
            <CardDescription>{t('historyDesc', { count: historyTotal })}</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="space-y-2">
                {history.map(task => (
                    <div key={task.id} className="flex items-center justify-between p-3 border-b last:border-0 text-sm">
                        <div className="flex items-center gap-3">
                            <StatusIcon status={task.status} />
                            <div>
                                <div className="font-medium">{task.description}</div>
                                <div className="text-xs text-muted-foreground flex gap-2">
                                    <span>{new Date(task.startTime).toLocaleString(locale)}</span>
                                    {task.duration && <span>• {t('duration')}: {task.duration}</span>}
                                    {task.node && <span>• {task.node}</span>}
                                </div>
                            </div>
                        </div>
                        <Badge variant={task.status === 'completed' ? 'secondary' : (task.status === 'failed' ? 'destructive' : 'default')}>
                            {formatStatus(task.status)}
                        </Badge>
                    </div>
                ))}
            </div>

            {/* Pagination Footer */}
            {historyTotal > historyPageSize && (
                <div className="border-t mt-4 pt-3 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                        {t('showing', {
                            from: historyPage * historyPageSize + 1,
                            to: Math.min((historyPage + 1) * historyPageSize, historyTotal),
                            total: historyTotal
                        })}
                    </span>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setHistoryPage(p => Math.max(0, p - 1))}
                            disabled={!canHistoryPrev}
                        >
                            <ChevronLeft className="h-4 w-4 mr-1" />
                            {t('back')}
                        </Button>
                        <span className="text-sm text-muted-foreground">
                            {t('page', { page: historyPage + 1, total: historyTotalPages })}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setHistoryPage(p => p + 1)}
                            disabled={!canHistoryNext}
                        >
                            {t('next')}
                            <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                    </div>
                </div>
            )}
        </CardContent>
    </Card>
        </div >
    );
}

function StatusIcon({ status }: { status: string }) {
    switch (status) {
        case 'completed': return <CheckCircle2 className="h-4 w-4 text-green-500" />;
        case 'failed': return <XCircle className="h-4 w-4 text-red-500" />;
        case 'running': return <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />;
        default: return <div className="h-4 w-4 rounded-full bg-slate-200" />;
    }
}
