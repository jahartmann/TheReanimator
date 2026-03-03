/**
 * MigrationNew page — 4-step wizard to create a VM migration task.
 *
 * Step 1: Select source + target node
 * Step 2: Choose VMs from source
 * Step 3: Storage, bridge, and options
 * Step 4: Confirm and start
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, apiCall } from '../hooks/useApi';
import {
  ArrowLeft, ArrowRight, Check, Server, HardDrive, Network,
  Loader2, MoveRight, AlertTriangle, SquareCheck, Square,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServerItem {
  id: number;
  name: string;
  type: string;
  ssh_host?: string;
}

interface VMItem {
  id: number;
  vmid: number;
  name: string;
  type: 'qemu' | 'lxc';
  status: 'running' | 'stopped' | string;
  tags?: string;
}

interface StorageItem {
  name: string;
  type: string;
  active: boolean;
}

interface BridgeItem {
  name: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4;

const STEP_LABELS = ['Source & Target', 'Select VMs', 'Options', 'Confirm'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0">
      {STEP_LABELS.map((label, idx) => {
        const step = idx + 1;
        const done = step < current;
        const active = step === current;
        return (
          <React.Fragment key={step}>
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors ${
                  done
                    ? 'bg-primary border-primary text-primary-foreground'
                    : active
                    ? 'border-primary text-primary bg-background'
                    : 'border-muted-foreground/30 text-muted-foreground bg-muted'
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : step}
              </div>
              <span className={`text-[10px] mt-1 hidden sm:block ${active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                {label}
              </span>
            </div>
            {idx < TOTAL_STEPS - 1 && (
              <div className={`h-0.5 flex-1 mx-1 mb-4 transition-colors ${done ? 'bg-primary' : 'bg-muted'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function SelectField({
  label, value, onChange, children, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {children}
      </select>
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function InputField({
  label, value, onChange, placeholder, hint, mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary ${mono ? 'font-mono' : ''}`}
      />
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function VMTypeBadge({ type }: { type: string }) {
  return (
    <Badge
      variant="outline"
      className={`text-[9px] px-1 py-0 font-mono ${
        type === 'qemu'
          ? 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800/40 dark:text-blue-400'
          : 'text-purple-600 bg-purple-50 border-purple-200 dark:bg-purple-950/30 dark:border-purple-800/40 dark:text-purple-400'
      }`}
    >
      {type === 'qemu' ? 'QEMU' : 'LXC'}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const running = status === 'running';
  return (
    <Badge
      variant="outline"
      className={`text-[9px] px-1 py-0 ${
        running
          ? 'text-green-600 bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800/40 dark:text-green-400'
          : 'text-muted-foreground bg-muted border-border'
      }`}
    >
      {running ? 'running' : status}
    </Badge>
  );
}

// ─── MigrationNewPage ─────────────────────────────────────────────────────────

export default function MigrationNewPage() {
  const navigate = useNavigate();

  // ── Wizard state ──────────────────────────────────────────────────────────
  const [step, setStep] = useState(1);

  // Step 1
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');

  // Step 2
  const [vms, setVMs] = useState<VMItem[]>([]);
  const [vmsLoading, setVMsLoading] = useState(false);
  const [vmsError, setVMsError] = useState<string | null>(null);
  const [selectedVmids, setSelectedVmids] = useState<Set<number>>(new Set());

  // Step 3
  const [storages, setStorages] = useState<StorageItem[]>([]);
  const [bridges, setBridges] = useState<BridgeItem[]>([]);
  const [storagesLoading, setStoragesLoading] = useState(false);
  const [bridgesLoading, setBridgesLoading] = useState(false);
  const [targetStorage, setTargetStorage] = useState('');
  const [targetBridge, setTargetBridge] = useState('');
  const [deleteSource, setDeleteSource] = useState(false);

  // Step 4 (submit)
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Servers list
  const { data: servers, loading: serversLoading } = useApi<ServerItem[]>('/api/servers');
  const serverList = servers ?? [];

  // ── Load VMs when source changes ──────────────────────────────────────────
  useEffect(() => {
    if (!sourceId) { setVMs([]); setSelectedVmids(new Set()); return; }
    setVMsLoading(true);
    setVMsError(null);
    apiCall<VMItem[]>(`/api/servers/${sourceId}/vms-for-migration`)
      .then((data) => { setVMs(data); setSelectedVmids(new Set()); })
      .catch((e) => setVMsError(e.message))
      .finally(() => setVMsLoading(false));
  }, [sourceId]);

  // ── Load storages + bridges when target changes (Step 3 entry) ────────────
  async function loadTargetResources() {
    if (!targetId) return;

    setStoragesLoading(true);
    setBridgesLoading(true);

    apiCall<StorageItem[]>(`/api/servers/${targetId}/storages`)
      .then((data) => setStorages(data ?? []))
      .catch(() => setStorages([]))
      .finally(() => setStoragesLoading(false));

    apiCall<BridgeItem[]>(`/api/servers/${targetId}/bridges`)
      .then((data) => setBridges(data ?? []))
      .catch(() => setBridges([]))
      .finally(() => setBridgesLoading(false));
  }

  // ── VM selection helpers ──────────────────────────────────────────────────
  function toggleVM(vmid: number) {
    setSelectedVmids((prev) => {
      const next = new Set(prev);
      if (next.has(vmid)) next.delete(vmid);
      else next.add(vmid);
      return next;
    });
  }

  function selectAll() { setSelectedVmids(new Set(vms.map((v) => v.vmid))); }
  function deselectAll() { setSelectedVmids(new Set()); }

  // ── Navigation ────────────────────────────────────────────────────────────
  function goNext() {
    if (step === 2) loadTargetResources();
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }

  function goBack() { setStep((s) => Math.max(s - 1, 1)); }

  function canGoNext(): boolean {
    if (step === 1) return !!sourceId && !!targetId && sourceId !== targetId;
    if (step === 2) return selectedVmids.size > 0;
    if (step === 3) return true;
    return false;
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleStart() {
    setSubmitting(true);
    setSubmitError(null);

    const selectedVMs = vms.filter((v) => selectedVmids.has(v.vmid));

    try {
      const result = await apiCall<{ success: boolean; taskId: number; error?: string }>('/api/migrations', {
        method: 'POST',
        body: JSON.stringify({
          source_server_id: parseInt(sourceId),
          target_server_id: parseInt(targetId),
          vmids: selectedVMs.map((v) => v.vmid),
          vm_types: selectedVMs.map((v) => v.type),
          target_storage: targetStorage || undefined,
          target_bridge: targetBridge || undefined,
          delete_source: deleteSource,
        }),
      });

      if (result?.success && result.taskId) {
        navigate(`/migrations/${result.taskId}`);
      } else {
        setSubmitError(result?.error || 'Unknown error starting migration');
      }
    } catch (e: any) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const sourceName = serverList.find((s) => String(s.id) === sourceId)?.name ?? '—';
  const targetName = serverList.find((s) => String(s.id) === targetId)?.name ?? '—';
  const selectedVMs = vms.filter((v) => selectedVmids.has(v.vmid));

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2 max-w-2xl">

        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/migrations')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">New VM Migration</h1>
            <p className="text-sm text-muted-foreground">
              Migrate individual VMs and containers between Proxmox nodes
            </p>
          </div>
        </div>

        {/* Step indicator */}
        <StepIndicator current={step} />

        {/* ── Step 1: Source & Target ─────────────────────────────────────── */}
        {step === 1 && (
          <Card className="border-muted/60">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Server className="h-4 w-4" />
                Select Source and Target Node
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {serversLoading ? (
                <div className="flex items-center justify-center h-24">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <SelectField
                    label="Source Node"
                    value={sourceId}
                    onChange={(v) => { setSourceId(v); setSelectedVmids(new Set()); }}
                    hint="VMs will be migrated FROM this node"
                  >
                    <option value="">Select source node…</option>
                    {serverList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.type.toUpperCase()}){s.ssh_host ? ` — ${s.ssh_host}` : ''}
                      </option>
                    ))}
                  </SelectField>

                  <SelectField
                    label="Target Node"
                    value={targetId}
                    onChange={setTargetId}
                    hint="VMs will be migrated TO this node"
                  >
                    <option value="">Select target node…</option>
                    {serverList
                      .filter((s) => String(s.id) !== sourceId)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.type.toUpperCase()}){s.ssh_host ? ` — ${s.ssh_host}` : ''}
                        </option>
                      ))}
                  </SelectField>

                  {sourceId && targetId && sourceId === targetId && (
                    <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs flex gap-2 items-start">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      Source and target must be different nodes.
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Step 2: Select VMs ──────────────────────────────────────────── */}
        {step === 2 && (
          <Card className="border-muted/60">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <MoveRight className="h-4 w-4" />
                Select VMs to Migrate
                {selectedVmids.size > 0 && (
                  <Badge variant="secondary" className="ml-2 text-[10px]">
                    {selectedVmids.size} selected
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {vmsLoading && (
                <div className="flex items-center justify-center h-24">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
              {vmsError && (
                <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                  {vmsError}
                </div>
              )}
              {!vmsLoading && !vmsError && vms.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No VMs found on <strong>{sourceName}</strong>.
                </p>
              )}

              {!vmsLoading && vms.length > 0 && (
                <div className="space-y-3">
                  {/* Select all / deselect all */}
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={selectAll} className="text-xs h-7">
                      <SquareCheck className="h-3.5 w-3.5 mr-1.5" />
                      Select All
                    </Button>
                    <Button variant="ghost" size="sm" onClick={deselectAll} className="text-xs h-7">
                      <Square className="h-3.5 w-3.5 mr-1.5" />
                      Deselect All
                    </Button>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {vms.length} VM{vms.length !== 1 ? 's' : ''} on {sourceName}
                    </span>
                  </div>

                  {/* VM list */}
                  <div className="divide-y divide-border/50 rounded-md border border-input overflow-hidden">
                    {vms.map((vm) => {
                      const checked = selectedVmids.has(vm.vmid);
                      return (
                        <button
                          key={vm.vmid}
                          type="button"
                          onClick={() => toggleVM(vm.vmid)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors ${checked ? 'bg-primary/5' : ''}`}
                        >
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-primary border-primary' : 'border-muted-foreground/40'}`}>
                            {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium font-mono">{vm.vmid}</span>
                              <span className="text-sm text-foreground/80 truncate">{vm.name || '(unnamed)'}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <VMTypeBadge type={vm.type} />
                            <StatusBadge status={vm.status} />
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {selectedVmids.size > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {selectedVmids.size} VM{selectedVmids.size !== 1 ? 's' : ''} selected for migration
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Step 3: Options ─────────────────────────────────────────────── */}
        {step === 3 && (
          <Card className="border-muted/60">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                Migration Options
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Target Storage */}
              {storagesLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading storages…
                </div>
              ) : storages.length > 0 ? (
                <SelectField
                  label="Target Storage"
                  value={targetStorage}
                  onChange={setTargetStorage}
                  hint="Storage pool on the target node (leave blank to auto-detect)"
                >
                  <option value="">Auto-detect / keep original</option>
                  {storages.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} ({s.type})
                    </option>
                  ))}
                </SelectField>
              ) : (
                <InputField
                  label="Target Storage"
                  value={targetStorage}
                  onChange={setTargetStorage}
                  placeholder="local-lvm"
                  hint="Storage pool on target node (e.g. local-lvm, zfs-pool) — leave blank for auto"
                  mono
                />
              )}

              {/* Target Bridge */}
              {bridgesLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading bridges…
                </div>
              ) : bridges.length > 0 ? (
                <SelectField
                  label="Target Network Bridge"
                  value={targetBridge}
                  onChange={setTargetBridge}
                  hint="Network bridge on the target node"
                >
                  <option value="">Auto-detect / keep original</option>
                  {bridges.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </SelectField>
              ) : (
                <InputField
                  label="Target Network Bridge"
                  value={targetBridge}
                  onChange={setTargetBridge}
                  placeholder="vmbr0"
                  hint="Network bridge on target node (e.g. vmbr0) — leave blank to keep original"
                  mono
                />
              )}

              {/* Delete source */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-2">Post-Migration</label>
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={deleteSource}
                    onChange={(e) => setDeleteSource(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border border-input accent-primary cursor-pointer"
                  />
                  <div>
                    <span className="text-sm group-hover:text-foreground transition-colors">
                      Delete source VMs after successful migration
                    </span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Only deletes after verifying the VM exists on the target. Unchecked by default.
                    </p>
                  </div>
                </label>
              </div>

              {/* Summary */}
              <div className="p-3 rounded-md bg-muted/50 border border-border text-xs space-y-1 text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Server className="h-3.5 w-3.5 shrink-0" />
                  <span><strong className="text-foreground">{sourceName}</strong> <ArrowRight className="h-3 w-3 inline" /> <strong className="text-foreground">{targetName}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <MoveRight className="h-3.5 w-3.5 shrink-0" />
                  <span>{selectedVmids.size} VM{selectedVmids.size !== 1 ? 's' : ''} selected</span>
                </div>
                {targetStorage && (
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-3.5 w-3.5 shrink-0" />
                    <span>Storage: <code className="font-mono text-foreground">{targetStorage}</code></span>
                  </div>
                )}
                {targetBridge && (
                  <div className="flex items-center gap-2">
                    <Network className="h-3.5 w-3.5 shrink-0" />
                    <span>Bridge: <code className="font-mono text-foreground">{targetBridge}</code></span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Step 4: Confirm ─────────────────────────────────────────────── */}
        {step === 4 && (
          <Card className="border-muted/60">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Check className="h-4 w-4" />
                Confirm Migration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Summary */}
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 rounded-md bg-muted/40 border border-border">
                  <Server className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">Migration Route</p>
                    <p className="text-sm font-semibold">
                      {sourceName} <ArrowRight className="h-3.5 w-3.5 inline mx-1" /> {targetName}
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-md bg-muted/40 border border-border space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground mb-2">VMs to Migrate ({selectedVMs.length})</p>
                  {selectedVMs.map((vm) => (
                    <div key={vm.vmid} className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-foreground/80">{vm.vmid}</span>
                      <span className="text-foreground">{vm.name || '(unnamed)'}</span>
                      <VMTypeBadge type={vm.type} />
                      <StatusBadge status={vm.status} />
                    </div>
                  ))}
                </div>

                {(targetStorage || targetBridge || deleteSource) && (
                  <div className="p-3 rounded-md bg-muted/40 border border-border space-y-1 text-sm">
                    {targetStorage && (
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>Storage: <code className="font-mono">{targetStorage}</code></span>
                      </div>
                    )}
                    {targetBridge && (
                      <div className="flex items-center gap-2">
                        <Network className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>Bridge: <code className="font-mono">{targetBridge}</code></span>
                      </div>
                    )}
                    {deleteSource && (
                      <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span>Source VMs will be deleted after successful migration</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-950/20 dark:border-amber-800/30 dark:text-amber-400 text-xs flex gap-2 items-start">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>Note:</strong> VMs will be stopped during migration unless online migration is supported.
                    Ensure the target node has sufficient CPU, memory, and storage capacity.
                  </div>
                </div>
              </div>

              {submitError && (
                <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  {submitError}
                </div>
              )}

              <Button
                size="default"
                className="w-full"
                onClick={handleStart}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting Migration…
                  </>
                ) : (
                  <>
                    <MoveRight className="mr-2 h-4 w-4" />
                    Start Migration
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ── Navigation buttons ───────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-1">
          <Button
            variant="outline"
            onClick={step === 1 ? () => navigate('/migrations') : goBack}
            disabled={submitting}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>

          {step < TOTAL_STEPS && (
            <Button onClick={goNext} disabled={!canGoNext()}>
              Next
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
