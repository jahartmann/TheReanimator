'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from "@/components/ui/scroll-area"
import { ListTodo, Loader2, StopCircle, Terminal, CheckCircle2, XCircle, AlertTriangle, Eye, Clock, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { getAllTasks, TaskItem, PaginatedTasks, cancelTask } from '@/lib/actions/tasks';
import { toast } from 'sonner';
import { cn } from "@/lib/utils";
import { useTranslations } from 'next-intl';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface TaskManagerProps {
    className?: string;
}

export default function TaskManager({ className }: TaskManagerProps) {
    const t = useTranslations('tasks');
    const [open, setOpen] = useState(false);
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
    const [loading, setLoading] = useState(false);

    // Pagination state
    const [page, setPage] = useState(0);
    const [total, setTotal] = useState(0);
    const pageSize = 30;

    // Initial fetch
    useEffect(() => {
        if (open) fetchTasks();
    }, [open, page]);

    // Poll when open (only for running tasks, don't reset page)
    useEffect(() => {
        if (!open) return;
        const interval = setInterval(() => fetchTasks(false), 3000);
        return () => clearInterval(interval);
    }, [open, page]);

    // Poll selected task for live logs
    useEffect(() => {
        if (open && selectedTask && selectedTask.status === 'running') {
            const interval = setInterval(async () => {
                // Determine if we need to refetch list or just task?
                // For simplicity, we just rely on the main poll updating the list, 
                // but we need to update 'selectedTask' reference from the list.
                // Or we could fetch specific task details if API existed.
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [open, selectedTask]);

    // Sync selected task with list updates
    useEffect(() => {
        if (selectedTask) {
            const updated = tasks.find(t => t.id === selectedTask.id);
            if (updated) setSelectedTask(updated);
        }
    }, [tasks]);

    async function fetchTasks(showLoading = true) {
        if (showLoading) setLoading(true);
        try {
            const res = await getAllTasks(pageSize, page * pageSize);
            setTasks(res.items);
            setTotal(res.total);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    const totalPages = Math.ceil(total / pageSize);
    const canPrev = page > 0;
    const canNext = page < totalPages - 1;

    async function handleCancel(eventId: React.MouseEvent, task: TaskItem) {
        eventId.stopPropagation();
        if (!confirm(t('stopConfirm'))) return;
        try {
            await cancelTask(task.id);
            toast.success(t('stopSignalSent'));
            fetchTasks();
        } catch (e) {
            toast.error(t('stopError'));
        }
    }

    const runningCount = tasks.filter(t => t.status === 'running').length;

    return (
        <>
            {/* Sidebar Trigger Item */}
            <div
                onClick={() => setOpen(true)}
                className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-md text-sm font-medium transition-colors cursor-pointer text-muted-foreground hover:text-foreground hover:bg-white/5",
                    className
                )}
            >
                <ListTodo className="h-4 w-4" />
                <span className="flex-1">{t('title')}</span>
                {runningCount > 0 && (
                    <Badge variant="default" className="text-[10px] h-5 px-1.5 bg-blue-600 animate-pulse">
                        {runningCount}
                    </Badge>
                )}
            </div>

            {/* Main Task Sheet (Simulated with Dialog) */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="fixed right-0 top-0 h-screen w-[850px] max-w-none rounded-none border-l bg-background p-0 shadow-2xl data-[state=open]:slide-in-from-right sm:max-w-none">
                    <DialogHeader className="p-6 pb-4 border-b">
                        <DialogTitle className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <ListTodo className="h-5 w-5" />
                                <span>{t('taskCenter')}</span>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => fetchTasks()} disabled={loading}>
                                <Clock className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                                {t('refresh')}
                            </Button>
                        </DialogTitle>
                        <DialogDescription>
                            {t('description')}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 flex overflow-hidden">
                        {/* Task List - Takes full width if no task selected, else 40% */}
                        <div className={`flex flex-col border-r transition-all duration-300 ${selectedTask ? 'w-[40%]' : 'w-full'}`}>
                            <div className="flex-1 overflow-auto">
                                <Table>
                                    <TableHeader className="sticky top-0 bg-background z-10 transition-none">
                                        <TableRow>
                                            <TableHead className="w-[140px]">{t('time')}</TableHead>
                                            <TableHead>{t('activity')}</TableHead>
                                            <TableHead className="w-[80px]">{t('status')}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {tasks.map((task) => (
                                            <TableRow
                                                key={task.id}
                                                className={cn(
                                                    "cursor-pointer hover:bg-muted/50 transition-colors",
                                                    selectedTask?.id === task.id && "bg-muted border-l-4 border-l-primary"
                                                )}
                                                onClick={() => setSelectedTask(task)}
                                            >
                                                <TableCell className="text-xs text-muted-foreground">
                                                    <div className="font-mono">{new Date(task.startTime).toLocaleTimeString()}</div>
                                                    <div className="text-[10px] opacity-70">{new Date(task.startTime).toLocaleDateString()}</div>
                                                </TableCell>
                                                <TableCell className="py-3">
                                                    <div className="font-medium text-sm truncate max-w-[200px]" title={task.description}>
                                                        {task.description}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-1">
                                                        {task.type === 'scan' && <Eye className="h-3 w-3" />}
                                                        {task.type === 'background' && <RefreshCw className="h-3 w-3" />}
                                                        {task.node || 'System'}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        <TaskStatusIcon status={task.status} />
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {tasks.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={3} className="text-center py-12 text-muted-foreground">{t('noActiveTasks')}</TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Pagination Footer */}
                            {total > pageSize && (
                                <div className="border-t p-2 flex items-center justify-between bg-muted/30">
                                    <span className="text-xs text-muted-foreground">
                                        {t('totalTasks', { count: total })}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setPage(p => Math.max(0, p - 1))}
                                            disabled={!canPrev}
                                            className="h-7"
                                        >
                                            <ChevronLeft className="h-4 w-4" />
                                            {t('back')}
                                        </Button>
                                        <span className="text-xs text-muted-foreground px-2">
                                            {t('page', { page: page + 1, total: totalPages })}
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setPage(p => p + 1)}
                                            disabled={!canNext}
                                            className="h-7"
                                        >
                                            {t('next')}
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Log View - 60% */}
                        {selectedTask && (
                            <div className="flex-1 flex flex-col bg-black/95 text-green-400 font-mono text-xs h-full animate-in slide-in-from-right duration-300 shadow-inner">
                                <div className="p-3 border-b border-white/10 flex items-center justify-between bg-white/5 backdrop-blur">
                                    <span className="font-bold flex items-center gap-2 truncate max-w-[300px]">
                                        <Terminal className="h-4 w-4 text-primary" />
                                        {selectedTask.description}
                                    </span>
                                    <div className="flex items-center gap-1">
                                        {selectedTask.status === 'running' && (
                                            <Button variant="destructive" size="sm" className="h-7 px-2 text-[10px] uppercase tracking-wider" onClick={(e) => handleCancel(e, selectedTask)}>
                                                <StopCircle className="mr-1 h-3 w-3" /> {t('stop')}
                                            </Button>
                                        )}
                                        <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-white/10" onClick={() => setSelectedTask(null)}>
                                            <XCircle className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                <ScrollArea className="flex-1 p-4 whitespace-pre-wrap select-text font-mono leading-relaxed">
                                    {selectedTask.log || <span className="opacity-50 italic">{t('waitingForLogs')}</span>}
                                    {selectedTask.status === 'running' && (
                                        <div className="mt-2 animate-pulse text-primary">_</div>
                                    )}
                                </ScrollArea>
                                <div className="p-2 border-t border-white/10 text-[10px] text-white/30 flex justify-between bg-black">
                                    <span>UID: {selectedTask.id}</span>
                                    <span>{selectedTask.status.toUpperCase()}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}

function TaskStatusIcon({ status }: { status: string }) {
    switch (status) {
        case 'running': return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
        case 'completed':
        case 'success': return <CheckCircle2 className="h-4 w-4 text-green-500" />;
        case 'failed': return <XCircle className="h-4 w-4 text-red-500" />;
        case 'cancelled': return <StopCircle className="h-4 w-4 text-orange-500" />;
        case 'warning': return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
        default: return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
    }
}
