'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { getAllTasks, TaskItem, cancelTask } from '@/lib/actions/tasks';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCw, ListTodo, CheckCircle2, XCircle, StopCircle, Terminal, Search, Clock, Activity, ArrowRightLeft, ScanLine, Trash2, X } from "lucide-react";
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function TasksPage() {
    const t = useTranslations('tasks');
    const locale = useLocale();
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [filteredTasks, setFilteredTasks] = useState<TaskItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);

    const selectedTaskIdRef = useRef<string | null>(null);

    // Filters
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [filterType, setFilterType] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState<string>('');

    useEffect(() => {
        selectedTaskIdRef.current = selectedTask?.id ?? null;
    }, [selectedTask]);

    const loadTasks = useCallback(async () => {
        const res = await getAllTasks(200);
        setTasks(res.items);
        setLoading(false);

        if (selectedTaskIdRef.current) {
            const updated = res.items.find((t: TaskItem) => t.id === selectedTaskIdRef.current);
            if (updated) {
                setSelectedTask(updated);
            }
        }
    }, []);

    useEffect(() => {
        loadTasks();
        const interval = setInterval(loadTasks, 2000);
        return () => clearInterval(interval);
    }, [loadTasks]);

    useEffect(() => {
        let res = tasks;
        if (filterStatus !== 'all') {
            res = res.filter(t => t.status === filterStatus);
        }
        if (filterType !== 'all') {
            res = res.filter(t => t.type === filterType);
        }
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

    async function handleStopTask(task: TaskItem) {
        if (!confirm(t('stopConfirm', { description: task.description }))) return;
        try {
            await cancelTask(task.id);
            toast.success(t('stopSignalSent'));
            loadTasks();
        } catch (e) {
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
            default: return <Activity className="h-3.5 w-3.5 text-muted-foreground" />;
        }
    };

    const getStatusText = (status: string): string => {
        const statusMap: Record<string, string> = {
            'running': t('statusRunning'),
            'completed': t('statusCompleted'),
            'success': t('statusSuccess'),
            'failed': t('statusFailed'),
            'cancelled': t('statusCancelled'),
            'pending': t('statusPending')
        };
        return statusMap[status] || status;
    };

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'scan': return <ScanLine className="h-3 w-3" />;
            case 'migration': return <ArrowRightLeft className="h-3 w-3" />;
            default: return <Activity className="h-3 w-3" />;
        }
    };

    const getTypeText = (type: string): string => {
        const typeMap: Record<string, string> = {
            'scan': t('typeScan'),
            'migration': t('typeMigration'),
            'background': t('typeBackground'),
            'config': t('typeConfig')
        };
        return typeMap[type] || type;
    };

    // Stats
    const runningCount = tasks.filter(t => t.status === 'running').length;
    const completedCount = tasks.filter(t => t.status === 'completed').length;
    const failedCount = tasks.filter(t => t.status === 'failed').length;

    return (
        <div className="h-[calc(100vh-2rem)] flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <div className="bg-primary/10 p-2.5 rounded-xl">
                        <ListTodo className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">
                            {t('taskCenter')}
                        </h1>
                        <p className="text-sm text-muted-foreground">{t('description')}</p>
                    </div>
                </div>

                {/* Quick Stats */}
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-4 text-sm mr-4">
                        {runningCount > 0 && (
                            <div className="flex items-center gap-1.5">
                                <span className="h-2 w-2 bg-blue-500 rounded-full animate-pulse" />
                                <span className="font-medium text-blue-600">{runningCount} {t('active')}</span>
                            </div>
                        )}
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            <span>{completedCount}</span>
                        </div>
                        {failedCount > 0 && (
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                                <XCircle className="h-3.5 w-3.5 text-red-500" />
                                <span>{failedCount}</span>
                            </div>
                        )}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => loadTasks()} disabled={loading}>
                        <RefreshCw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} />
                        {t('refresh')}
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex gap-2 shrink-0">
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

            {/* Main Content */}
            <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
                {/* Task List */}
                <div className={cn("flex flex-col transition-all duration-300 min-h-0", selectedTask ? "w-[55%]" : "w-full")}>
                    <div className="flex items-center justify-between px-1 pb-2">
                        <span className="text-xs text-muted-foreground font-medium">
                            {filteredTasks.length} {t('tasks')}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                            Auto-refresh 2s
                        </span>
                    </div>
                    <ScrollArea className="flex-1 rounded-lg border bg-card">
                        <div className="divide-y">
                            {loading && filteredTasks.length === 0 ? (
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
                                            "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors group",
                                            selectedTask?.id === task.id
                                                ? "bg-primary/5 border-l-2 border-l-primary"
                                                : "hover:bg-muted/50 border-l-2 border-l-transparent"
                                        )}
                                        onClick={() => setSelectedTask(task)}
                                    >
                                        {/* Status Icon */}
                                        <div className="shrink-0">
                                            {getStatusIcon(task.status)}
                                        </div>

                                        {/* Main Content */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-medium truncate">{task.description || task.id}</span>
                                                <Badge variant="outline" className="text-[9px] uppercase px-1.5 py-0 gap-1 shrink-0">
                                                    {getTypeIcon(task.type)}
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

                                        {/* Right Side */}
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
                        {/* Panel Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20 shrink-0">
                            <div className="flex items-center gap-2 min-w-0">
                                {getStatusIcon(selectedTask.status)}
                                <span className="font-medium text-sm truncate">{selectedTask.description}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                {selectedTask.status === 'running' && (
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        className="h-7 text-xs"
                                        onClick={() => handleStopTask(selectedTask)}
                                    >
                                        <StopCircle className="mr-1 h-3 w-3" />
                                        {t('stop')}
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => setSelectedTask(null)}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        {/* Task Info */}
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

                        {/* Log Output */}
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
                                    {selectedTask.status === 'running' && (
                                        <span className="animate-pulse ml-0.5 text-zinc-500">|</span>
                                    )}
                                </pre>
                            </ScrollArea>
                            <div className="px-3 py-1.5 border-t border-zinc-800 text-[10px] text-zinc-600 flex justify-between shrink-0">
                                <span>{selectedTask.id.slice(0, 16)}</span>
                                <span className={cn(
                                    selectedTask.status === 'running' && 'text-blue-400',
                                    selectedTask.status === 'completed' && 'text-green-400',
                                    selectedTask.status === 'failed' && 'text-red-400'
                                )}>
                                    {getStatusText(selectedTask.status).toUpperCase()}
                                </span>
                            </div>
                        </div>
                    </Card>
                )}
            </div>
        </div>
    );
}
