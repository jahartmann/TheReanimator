/**
 * DisasterRecovery.tsx
 *
 * Professional Disaster Recovery center with:
 *  - Status dashboard (server health at a glance)
 *  - Recovery Plans (CRUD + dry-run + execute)
 *  - Emergency Quick Recovery (ad-hoc, no saved plan needed)
 *  - Execution History (full log viewer)
 */

import React, { useState, useCallback } from 'react';
import { useApi, apiCall } from '../hooks/useApi';
import {
  ShieldAlert, RefreshCw, Clock, CheckCircle, XCircle,
  AlertTriangle, Plus, Trash2, Play, FlaskConical, Pencil,
  Server, DatabaseBackup, ChevronDown, ChevronRight, Zap,
  ArrowRight, FileText, List,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Server {
  id: number;
  name: string;
  type: string;
  ssh_host: string;
  vm_count: number;
  last_backup_at: string | null;
  backup_count: number;
  has_recent_backup: boolean;
}

interface RecoveryPlan {
  id: number;
  name: string;
  description: string | null;
  source_server_id: number | null;
  target_server_id: number | null;
  source_name: string | null;
  target_name: string | null;
  steps: string[];
  step_count: number;
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
  updated_at: string;
}

interface Execution {
  id: number;
  plan_id: string | null;
  status: string;
  dry_run: number;
  log: string;
  log_snippet: string;
  started_at: string;
  completed_at: string | null;
  duration: string | null;
  resolved_plan_name: string;
}

const RECOVERY_ACTIONS = [
  { id: 'restore_configs', label: 'Restore Config Backups', desc: 'Restore /etc and SSH keys from backup' },
  { id: 'restore_vms', label: 'Migrate VMs', desc: 'Move running VMs to the target server' },
  { id: 'update_network', label: 'Update Network Config', desc: 'Reconfigure networking on target server' },
];

const RECOVERY_STEPS = [
  { id: 'restore_configs', label: 'Restore Configs (/etc, SSH keys, crontabs)' },
  { id: 'restore_vms', label: 'Migrate All VMs to target' },
  { id: 'restore_ssh_keys', label: 'Restore SSH Keys (/root/.ssh)' },
  { id: 'update_network', label: 'Update Network Configuration' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('default', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(d));
  } catch { return d; }
}

function formatDateShort(d: string | null): string {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('default', {
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(d));
  } catch { return d; }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    completed: { label: 'Completed', cls: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800' },
    success:   { label: 'Success',   cls: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800' },
    'dry-run': { label: 'Dry Run',   cls: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800' },
    running:   { label: 'Running',   cls: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800' },
    failed:    { label: 'Failed',    cls: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800' },
    partial:   { label: 'Partial',   cls: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800' },
    aborted:   { label: 'Aborted',   cls: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700' },
    pending:   { label: 'Pending',   cls: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700' },
  };
  const s = map[status] ?? { label: status, cls: 'bg-muted text-muted-foreground border-border' };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'completed' || status === 'success') return <CheckCircle className="h-4 w-4 text-green-500" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-red-500" />;
  if (status === 'running') return <Clock className="h-4 w-4 text-blue-500 animate-pulse" />;
  if (status === 'partial') return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// ─── PlanModal ────────────────────────────────────────────────────────────────

interface PlanModalProps {
  open: boolean;
  plan?: RecoveryPlan | null;
  servers: Server[];
  onClose: () => void;
  onSaved: () => void;
}

function PlanModal({ open, plan, servers, onClose, onSaved }: PlanModalProps) {
  const isEdit = !!plan;

  const [name, setName] = useState(plan?.name ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [sourceId, setSourceId] = useState(plan?.source_server_id ? String(plan.source_server_id) : '');
  const [targetId, setTargetId] = useState(plan?.target_server_id ? String(plan.target_server_id) : '');
  const [selectedSteps, setSelectedSteps] = useState<string[]>(
    plan?.steps?.length ? plan.steps : []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open/plan change
  React.useEffect(() => {
    setName(plan?.name ?? '');
    setDescription(plan?.description ?? '');
    setSourceId(plan?.source_server_id ? String(plan.source_server_id) : '');
    setTargetId(plan?.target_server_id ? String(plan.target_server_id) : '');
    setSelectedSteps(plan?.steps?.length ? plan.steps : []);
    setError(null);
  }, [plan, open]);

  const toggleStep = (stepId: string) => {
    setSelectedSteps(prev =>
      prev.includes(stepId) ? prev.filter(s => s !== stepId) : [...prev, stepId]
    );
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Plan name is required'); return; }
    setSaving(true);
    setError(null);

    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        source_server_id: sourceId ? Number(sourceId) : null,
        target_server_id: targetId ? Number(targetId) : null,
        steps: selectedSteps,
      };

      if (isEdit && plan) {
        await apiCall(`/api/dr/plans/${plan.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiCall('/api/dr/plans', { method: 'POST', body: JSON.stringify(body) });
      }

      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Recovery Plan' : 'New Recovery Plan'}</DialogTitle>
          <DialogDescription>
            Define a step-by-step plan to recover from a server failure.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="plan-name">Plan Name <span className="text-destructive">*</span></Label>
            <Input
              id="plan-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Recover pve-node-1 to pve-node-2"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan-desc">Description</Label>
            <Textarea
              id="plan-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional notes about this recovery plan…"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Source Server (failed)</Label>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select server…" />
                </SelectTrigger>
                <SelectContent>
                  {servers.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Target Server (replacement)</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select server…" />
                </SelectTrigger>
                <SelectContent>
                  {servers.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Recovery Steps</Label>
            <div className="rounded-md border divide-y">
              {RECOVERY_STEPS.map(step => (
                <label
                  key={step.id}
                  className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors"
                >
                  <Checkbox
                    checked={selectedSteps.includes(step.id)}
                    onCheckedChange={() => toggleStep(step.id)}
                  />
                  <span className="text-sm">{step.label}</span>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Plan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── ExecutionLogModal ────────────────────────────────────────────────────────

function ExecutionLogModal({ exec, onClose }: { exec: Execution | null; onClose: () => void }) {
  const { data: full } = useApi<Execution>(
    exec ? `/api/dr/executions/${exec.id}` : ''
  );

  const log = full?.log ?? exec?.log ?? '';

  return (
    <Dialog open={!!exec} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StatusIcon status={exec?.status ?? ''} />
            Execution #{exec?.id} — {exec?.resolved_plan_name}
          </DialogTitle>
          <DialogDescription>
            {exec?.dry_run ? 'Dry Run · ' : ''}{formatDate(exec?.started_at ?? null)}
            {exec?.duration ? ` · Duration: ${exec.duration}` : ''}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 rounded-md border bg-muted/30 p-3 mt-2">
          <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed text-foreground/80">
            {stripAnsi(log) || 'No log output available.'}
          </pre>
        </ScrollArea>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Section A: Recovery Plans ────────────────────────────────────────────────

function PlansSection({ servers, onExecutionStarted }: { servers: Server[]; onExecutionStarted: () => void }) {
  const { data, loading, refetch } = useApi<RecoveryPlan[]>('/api/dr/plans');
  const plans = data ?? [];

  const [modalOpen, setModalOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<RecoveryPlan | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecoveryPlan | null>(null);
  const [executing, setExecuting] = useState<number | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [confirmExec, setConfirmExec] = useState<string | null>(null);

  const openCreate = () => { setEditPlan(null); setModalOpen(true); };
  const openEdit = (p: RecoveryPlan) => { setEditPlan(p); setModalOpen(true); };

  const handleDelete = async (plan: RecoveryPlan) => {
    try {
      await apiCall(`/api/dr/plans/${plan.id}`, { method: 'DELETE' });
      refetch();
    } catch (err: any) {
      console.error('[DR] delete error:', err);
    }
    setDeleteTarget(null);
  };

  const handleExecute = async (plan: RecoveryPlan, dryRun: boolean) => {
    setExecuting(plan.id);
    setExecError(null);
    try {
      await apiCall('/api/dr/execute', {
        method: 'POST',
        body: JSON.stringify({ plan_id: plan.id, dry_run: dryRun }),
      });
      onExecutionStarted();
    } catch (err: any) {
      setExecError(err.message);
    } finally {
      setExecuting(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <List className="h-4 w-4 text-primary" />
          Recovery Plans
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            New Plan
          </Button>
        </div>
      </div>

      {execError && (
        <div className="mb-3 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {execError}
        </div>
      )}

      {loading && plans.length === 0 && (
        <div className="flex items-center justify-center h-24">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        </div>
      )}

      {!loading && plans.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 space-y-3">
            <ShieldAlert className="h-10 w-10 text-muted-foreground/40" />
            <div className="text-center">
              <p className="font-medium text-sm">No recovery plans defined</p>
              <p className="text-xs text-muted-foreground mt-1">Create a plan to prepare for server failures before they happen.</p>
            </div>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Create First Plan
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {plans.map(plan => (
          <Card key={plan.id} className="border-muted/60 hover:border-primary/30 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm truncate">{plan.name}</p>
                    {plan.step_count > 0 && (
                      <Badge variant="secondary" className="text-[10px]">{plan.step_count} steps</Badge>
                    )}
                    {plan.last_run_status && (
                      <StatusBadge status={plan.last_run_status} />
                    )}
                  </div>

                  {plan.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{plan.description}</p>
                  )}

                  <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                    {plan.source_name ? (
                      <>
                        <Server className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[140px]">{plan.source_name}</span>
                        <ArrowRight className="h-3 w-3 shrink-0" />
                        <Server className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[140px]">{plan.target_name ?? '?'}</span>
                      </>
                    ) : (
                      <span className="italic">No servers configured</span>
                    )}
                    {plan.last_run_at && (
                      <>
                        <span className="mx-1">·</span>
                        <span>Last run: {formatDateShort(plan.last_run_at)}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => openEdit(plan)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs text-blue-600 border-blue-200 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-900/20"
                    disabled={executing === plan.id}
                    onClick={() => handleExecute(plan, true)}
                    title="Dry Run — shows what would happen"
                  >
                    <FlaskConical className="h-3 w-3 mr-1" />
                    Dry Run
                  </Button>
                  {confirmExec === String(plan.id) ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setConfirmExec(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 px-2 text-xs bg-green-600 hover:bg-green-700 text-white"
                        disabled={executing === plan.id}
                        onClick={() => { setConfirmExec(null); handleExecute(plan, false); }}
                      >
                        Confirm Execute
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs text-green-600 border-green-200 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-900/20"
                      disabled={executing === plan.id}
                      onClick={() => setConfirmExec(String(plan.id))}
                      title="Execute recovery plan"
                    >
                      {executing === plan.id ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3 mr-1" />
                      )}
                      Execute
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive border-destructive/20 hover:bg-destructive/5"
                    onClick={() => setDeleteTarget(plan)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <PlanModal
        open={modalOpen}
        plan={editPlan}
        servers={servers}
        onClose={() => setModalOpen(false)}
        onSaved={refetch}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete recovery plan?</AlertDialogTitle>
            <AlertDialogDescription>
              "<strong>{deleteTarget?.name}</strong>" will be permanently deleted.
              Past execution history will be retained.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Section B: Quick Recovery ────────────────────────────────────────────────

function QuickRecoverySection({ servers, onExecutionStarted }: { servers: Server[]; onExecutionStarted: () => void }) {
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [selectedActions, setSelectedActions] = useState<string[]>(['restore_configs']);
  const [running, setRunning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDryRun, setPendingDryRun] = useState<boolean>(false);
  const [result, setResult] = useState<{ success: boolean; log?: string; error?: string } | null>(null);

  const toggleAction = (id: string) => {
    setSelectedActions(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  const canRun = sourceId && targetId && sourceId !== targetId && selectedActions.length > 0;

  const initiateRun = (dryRun: boolean) => {
    setPendingDryRun(dryRun);
    if (!dryRun) {
      setConfirmOpen(true);
    } else {
      executeRun(dryRun);
    }
  };

  const executeRun = useCallback(async (dryRun: boolean) => {
    setRunning(true);
    setResult(null);
    setConfirmOpen(false);

    try {
      const data = await apiCall<{ success: boolean; log: string }>('/api/dr/quick-recovery', {
        method: 'POST',
        body: JSON.stringify({
          source_server_id: Number(sourceId),
          target_server_id: Number(targetId),
          actions: selectedActions,
          dry_run: dryRun,
        }),
      });
      setResult({ success: true, log: data.log });
      onExecutionStarted();
    } catch (err: any) {
      setResult({ success: false, error: err.message });
    } finally {
      setRunning(false);
    }
  }, [sourceId, targetId, selectedActions, onExecutionStarted]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Zap className="h-4 w-4 text-amber-500" />
        <h2 className="text-base font-semibold">Emergency Recovery</h2>
        <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700">
          No plan required
        </Badge>
      </div>

      <Card className="border-amber-200/60 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-900/10">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-md bg-amber-100/50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              Use Quick Recovery for emergency situations where you need to act immediately without a pre-defined plan.
              Always do a Dry Run first to preview changes.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Which server failed?</Label>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Failed server…" />
                </SelectTrigger>
                <SelectContent>
                  {servers.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      <span className="flex items-center gap-2">
                        {s.name}
                        {!s.has_recent_backup && (
                          <span className="text-[10px] text-amber-600">(no recent backup)</span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Where to recover?</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder="Replacement server…" />
                </SelectTrigger>
                <SelectContent>
                  {servers
                    .filter(s => String(s.id) !== sourceId)
                    .map(s => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Recovery Actions</Label>
            <div className="rounded-md border divide-y bg-background">
              {RECOVERY_ACTIONS.map(action => (
                <label
                  key={action.id}
                  className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={selectedActions.includes(action.id)}
                    onCheckedChange={() => toggleAction(action.id)}
                  />
                  <div>
                    <p className="text-sm font-medium">{action.label}</p>
                    <p className="text-xs text-muted-foreground">{action.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button
              variant="outline"
              className="text-blue-600 border-blue-200 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-900/20"
              disabled={!canRun || running}
              onClick={() => initiateRun(true)}
            >
              <FlaskConical className="h-4 w-4 mr-2" />
              Dry Run First
            </Button>

            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-700 dark:hover:bg-amber-600"
              disabled={!canRun || running}
              onClick={() => initiateRun(false)}
            >
              {running ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              Execute Recovery
            </Button>

            {!canRun && (
              <span className="text-xs text-muted-foreground">
                {!sourceId || !targetId
                  ? 'Select source and target servers'
                  : sourceId === targetId
                  ? 'Source and target must differ'
                  : 'Select at least one action'}
              </span>
            )}
          </div>

          {result && (
            <div className={`p-3 rounded-md border text-sm ${
              result.success
                ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                : 'bg-destructive/10 border-destructive/20'
            }`}>
              {result.success ? (
                <>
                  <p className="font-medium text-green-700 dark:text-green-400 mb-2">Recovery executed. Check Execution History for details.</p>
                  {result.log && (
                    <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                      {stripAnsi(result.log)}
                    </pre>
                  )}
                </>
              ) : (
                <p className="text-destructive">{result.error}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirm dialog for real execution */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Execute Recovery — are you sure?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will modify your infrastructure. Selected actions will be executed against the target server.
              This action cannot be automatically undone.
              <br /><br />
              Actions: <strong>{selectedActions.join(', ')}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => executeRun(pendingDryRun)}
            >
              Yes, Execute Recovery
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Section C: Execution History ─────────────────────────────────────────────

function HistorySection({ refresh }: { refresh: number }) {
  const { data, loading, refetch } = useApi<Execution[]>('/api/dr/executions');
  const executions = data ?? [];

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [logModal, setLogModal] = useState<Execution | null>(null);

  // Re-fetch when parent tells us there's a new execution
  React.useEffect(() => {
    if (refresh > 0) refetch();
  }, [refresh, refetch]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          Execution History
        </h2>
        <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {loading && executions.length === 0 && (
        <div className="flex items-center justify-center h-24">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        </div>
      )}

      {!loading && executions.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 space-y-2">
            <Clock className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No executions yet</p>
          </CardContent>
        </Card>
      )}

      {executions.length > 0 && (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-8">#</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Plan</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">Started</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">Duration</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Log</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {executions.map(exec => (
                <React.Fragment key={exec.id}>
                  <tr
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setExpandedId(expandedId === exec.id ? null : exec.id)}
                  >
                    <td className="px-3 py-2.5 text-muted-foreground text-xs">{exec.id}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {expandedId === exec.id
                          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        }
                        <span className="font-medium truncate max-w-[200px]">
                          {exec.resolved_plan_name}
                        </span>
                        {exec.dry_run === 1 && (
                          <Badge variant="secondary" className="text-[10px]">dry run</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <StatusIcon status={exec.status} />
                        <StatusBadge status={exec.status} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">
                      {formatDateShort(exec.started_at)}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                      {exec.duration ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={e => { e.stopPropagation(); setLogModal(exec); }}
                      >
                        View Log
                      </Button>
                    </td>
                  </tr>
                  {expandedId === exec.id && (
                    <tr>
                      <td colSpan={6} className="px-4 pb-3 pt-0 bg-muted/20">
                        <pre className="text-xs font-mono mt-2 p-2 bg-muted/40 rounded whitespace-pre-wrap break-all max-h-40 overflow-auto text-muted-foreground leading-relaxed">
                          {stripAnsi(exec.log_snippet || exec.log || 'No log data') || '(empty log)'}
                          {(exec.log || '').length > 300 && (
                            <span className="text-primary cursor-pointer" onClick={() => setLogModal(exec)}>
                              {'\n'}… (click View Log for full output)
                            </span>
                          )}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ExecutionLogModal exec={logModal} onClose={() => setLogModal(null)} />
    </div>
  );
}

// ─── Status Dashboard ─────────────────────────────────────────────────────────

function StatusDashboard({ servers, plansCount }: { servers: Server[]; plansCount: number }) {
  const serversWithBackup = servers.filter(s => s.has_recent_backup).length;
  const lastBackupDate = servers
    .map(s => s.last_backup_at)
    .filter(Boolean)
    .sort()
    .reverse()[0] ?? null;

  const kpis = [
    {
      label: 'Total Servers',
      value: servers.length,
      icon: <Server className="h-5 w-5 text-muted-foreground" />,
      sub: `${servers.reduce((acc, s) => acc + (s.vm_count || 0), 0)} VMs total`,
    },
    {
      label: 'Servers Backed Up',
      value: `${serversWithBackup}/${servers.length}`,
      icon: <DatabaseBackup className="h-5 w-5 text-muted-foreground" />,
      sub: `within the last 7 days`,
      alert: serversWithBackup < servers.length,
    },
    {
      label: 'Last Backup',
      value: lastBackupDate ? formatDateShort(lastBackupDate) : 'Never',
      icon: <Clock className="h-5 w-5 text-muted-foreground" />,
      sub: lastBackupDate ? 'most recent config backup' : 'no backups found',
      alert: !lastBackupDate,
    },
    {
      label: 'Recovery Plans',
      value: plansCount,
      icon: <ShieldAlert className="h-5 w-5 text-muted-foreground" />,
      sub: plansCount === 0 ? 'Create a plan now' : 'plans defined',
      alert: plansCount === 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {kpis.map((kpi) => (
        <Card key={kpi.label} className={`border-muted/60 ${kpi.alert ? 'border-amber-300/60 dark:border-amber-700/40' : ''}`}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className={`text-xl font-bold mt-0.5 ${kpi.alert ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                  {kpi.value}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{kpi.sub}</p>
              </div>
              <div className={kpi.alert ? 'text-amber-500' : ''}>
                {kpi.icon}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── DisasterRecoveryPage ─────────────────────────────────────────────────────

export default function DisasterRecoveryPage() {
  const { data: servers, loading: serversLoading } = useApi<Server[]>('/api/dr/servers');
  const { data: plans } = useApi<RecoveryPlan[]>('/api/dr/plans');
  const [historyRefresh, setHistoryRefresh] = useState(0);

  const serverList = servers ?? [];
  const planList = plans ?? [];

  const handleExecutionStarted = useCallback(() => {
    setHistoryRefresh(n => n + 1);
  }, []);

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4 max-w-6xl mx-auto">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-primary" />
            Disaster Recovery
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define recovery plans, execute emergency recoveries, and track history.
          </p>
        </div>

        {/* Status dashboard */}
        {!serversLoading && (
          <StatusDashboard servers={serverList} plansCount={planList.length} />
        )}
        {serversLoading && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map(i => (
              <Card key={i} className="border-muted/60">
                <CardContent className="p-4">
                  <div className="h-14 bg-muted/40 rounded animate-pulse" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Separator />

        {/* Main tabs */}
        <Tabs defaultValue="plans">
          <TabsList className="mb-4">
            <TabsTrigger value="plans" className="gap-1.5">
              <List className="h-3.5 w-3.5" />
              Recovery Plans
              {planList.length > 0 && (
                <Badge variant="secondary" className="text-[10px] ml-1">{planList.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="quick" className="gap-1.5">
              <Zap className="h-3.5 w-3.5" />
              Emergency Recovery
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Execution History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="plans" className="mt-0">
            <PlansSection
              servers={serverList}
              onExecutionStarted={handleExecutionStarted}
            />
          </TabsContent>

          <TabsContent value="quick" className="mt-0">
            <QuickRecoverySection
              servers={serverList}
              onExecutionStarted={handleExecutionStarted}
            />
          </TabsContent>

          <TabsContent value="history" className="mt-0">
            <HistorySection refresh={historyRefresh} />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}
