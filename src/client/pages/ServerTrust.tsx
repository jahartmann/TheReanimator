/**
 * Server Trust page — SSH fingerprint management.
 * View, add, revoke, and scan SSH host fingerprints for registered servers.
 */

import React, { useState } from 'react';
import { useApi, apiCall } from '../hooks/useApi';
import {
  ShieldCheck, ShieldOff, ScanLine, Plus, Trash2, RefreshCw, Info,
  AlertCircle, CheckCircle2, Server, Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrustEntry {
  id: number;
  server_id: number;
  server_name: string;
  ssh_host: string | null;
  fingerprint: string | null;
  trusted_at: string;
  status: 'trusted' | 'revoked';
  notes: string | null;
}

interface ServerItem {
  id: number;
  name: string;
  ssh_host: string | null;
}

interface ScanResult {
  success: boolean;
  fingerprint: string | null;
  type: string | null;
  server_id: number;
  server_name: string;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateString: string | null): string {
  if (!dateString) return '—';
  try {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(dateString));
  } catch {
    return dateString;
  }
}

function truncateFingerprint(fp: string | null, maxLen = 40): string {
  if (!fp) return '—';
  if (fp.length <= maxLen) return fp;
  return `${fp.slice(0, 18)}…${fp.slice(-18)}`;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ServerTrustPage() {
  const { data: entries, loading: entriesLoading, refetch: refetchEntries } = useApi<TrustEntry[]>('/api/server-trust');
  const { data: servers, loading: serversLoading } = useApi<ServerItem[]>('/api/servers');

  const [busyId, setBusyId] = useState<number | null>(null);
  const [scanResults, setScanResults] = useState<Record<number, ScanResult>>({});
  const [scanningId, setScanningId] = useState<number | null>(null);
  const [trustingAll, setTrustingAll] = useState(false);
  const [trustAllMsg, setTrustAllMsg] = useState<string | null>(null);

  // Add dialog state
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ server_id: '', fingerprint: '', notes: '' });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const loading = entriesLoading || serversLoading;
  const trustEntries = entries ?? [];
  const allServers = servers ?? [];

  // Servers without a trust entry
  const trustedServerIds = new Set(trustEntries.map((e) => e.server_id));
  const untrustedServers = allServers.filter((s) => !trustedServerIds.has(s.id));

  async function handleRevoke(id: number) {
    setBusyId(id);
    try {
      await apiCall(`/api/server-trust/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'revoked' }),
      });
      refetchEntries();
    } catch { /* ignore */ } finally {
      setBusyId(null);
    }
  }

  async function handleReinstate(id: number) {
    setBusyId(id);
    try {
      await apiCall(`/api/server-trust/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'trusted' }),
      });
      refetchEntries();
    } catch { /* ignore */ } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: number, serverName: string) {
    if (!confirm(`Remove trust entry for "${serverName}"?`)) return;
    setBusyId(id);
    try {
      await apiCall(`/api/server-trust/${id}`, { method: 'DELETE' });
      refetchEntries();
    } catch { /* ignore */ } finally {
      setBusyId(null);
    }
  }

  async function handleScan(entry: TrustEntry) {
    setScanningId(entry.id);
    try {
      const result = await apiCall<ScanResult>(`/api/server-trust/scan/${entry.server_id}`, { method: 'POST' });
      setScanResults((prev) => ({ ...prev, [entry.id]: result }));
    } catch (err: any) {
      setScanResults((prev) => ({
        ...prev,
        [entry.id]: { success: false, fingerprint: null, type: null, server_id: entry.server_id, server_name: entry.server_name, error: err.message },
      }));
    } finally {
      setScanningId(null);
    }
  }

  async function handleUpdateFingerprint(entryId: number, newFingerprint: string) {
    setBusyId(entryId);
    try {
      await apiCall(`/api/server-trust/${entryId}`, {
        method: 'PUT',
        body: JSON.stringify({ fingerprint: newFingerprint }),
      });
      setScanResults((prev) => {
        const next = { ...prev };
        delete next[entryId];
        return next;
      });
      refetchEntries();
    } catch { /* ignore */ } finally {
      setBusyId(null);
    }
  }

  async function handleTrustAll() {
    setTrustingAll(true);
    setTrustAllMsg(null);
    try {
      const result = await apiCall<{ added: number; message: string }>('/api/server-trust/trust-all', { method: 'POST' });
      setTrustAllMsg(result.message || `Added ${result.added} trust entries`);
      refetchEntries();
      setTimeout(() => setTrustAllMsg(null), 4000);
    } catch (err: any) {
      setTrustAllMsg(`Error: ${err.message}`);
    } finally {
      setTrustingAll(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setAddError('');
    try {
      await apiCall('/api/server-trust', {
        method: 'POST',
        body: JSON.stringify({
          server_id: parseInt(addForm.server_id),
          fingerprint: addForm.fingerprint || undefined,
          notes: addForm.notes || undefined,
        }),
      });
      setShowAdd(false);
      setAddForm({ server_id: '', fingerprint: '', notes: '' });
      refetchEntries();
    } catch (err: any) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Lock className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Server Trust</h1>
            <p className="text-sm text-muted-foreground">SSH host fingerprint management and verification</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refetchEntries} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {untrustedServers.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleTrustAll}
              disabled={trustingAll}
              className="text-green-600 hover:text-green-700 border-green-200 hover:border-green-300 hover:bg-green-50"
            >
              {trustingAll
                ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-b border-current mr-1.5" />
                : <ShieldCheck className="h-4 w-4 mr-1.5" />
              }
              Trust All ({untrustedServers.length})
            </Button>
          )}
          <Button size="sm" onClick={() => setShowAdd(true)} disabled={untrustedServers.length === 0}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Trust
          </Button>
        </div>
      </div>

      {/* Trust all message */}
      {trustAllMsg && (
        <div className={`p-3 rounded-lg text-sm ${trustAllMsg.startsWith('Error') ? 'bg-destructive/10 text-destructive border border-destructive/20' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          {trustAllMsg}
        </div>
      )}

      {/* Explanation panel */}
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-3">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800 dark:text-blue-300 space-y-1">
              <p className="font-medium">What is server trust?</p>
              <p>
                Reanimator can verify SSH host fingerprints to prevent Man-in-the-Middle (MITM) attacks.
                A fingerprint uniquely identifies a server's SSH key. If it changes unexpectedly, it may indicate
                a security incident or server replacement.
              </p>
              <p>
                Use "Scan Current Fingerprint" to fetch the live fingerprint from any server and compare it with
                the stored value.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Trust entries table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Trusted Servers
            {trustEntries.length > 0 && (
              <Badge variant="secondary" className="ml-1">{trustEntries.length}</Badge>
            )}
          </CardTitle>
          <CardDescription>SSH fingerprints for registered servers</CardDescription>
        </CardHeader>
        <CardContent>
          {entriesLoading ? (
            <div className="flex items-center justify-center h-24">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : trustEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <ShieldCheck className="h-8 w-8 text-muted-foreground mb-2 opacity-40" />
              <p className="text-sm text-muted-foreground">No trust entries yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Click "Add Trust" to add a server fingerprint
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {trustEntries.map((entry) => {
                const scan = scanResults[entry.id];
                const fingerprintMismatch = scan?.fingerprint && entry.fingerprint && scan.fingerprint !== entry.fingerprint;

                return (
                  <div
                    key={entry.id}
                    className={`border rounded-lg p-4 space-y-3 ${
                      entry.status === 'revoked'
                        ? 'border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/10'
                        : 'border-border'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{entry.server_name}</span>
                            {entry.ssh_host && (
                              <span className="text-xs text-muted-foreground font-mono">{entry.ssh_host}</span>
                            )}
                            {entry.status === 'revoked' ? (
                              <Badge variant="destructive" className="text-xs">Revoked</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0">
                                Trusted
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Trusted since {formatDate(entry.trusted_at)}
                            {entry.notes && ` · ${entry.notes}`}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleScan(entry)}
                          disabled={scanningId === entry.id || busyId === entry.id}
                          className="h-7 text-xs"
                        >
                          {scanningId === entry.id
                            ? <div className="h-3 w-3 animate-spin rounded-full border-b border-current mr-1" />
                            : <ScanLine className="h-3 w-3 mr-1" />
                          }
                          Scan
                        </Button>
                        {entry.status === 'revoked' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleReinstate(entry.id)}
                            disabled={busyId === entry.id}
                            className="h-7 text-xs text-green-600 hover:text-green-700"
                          >
                            {busyId === entry.id
                              ? <div className="h-3 w-3 animate-spin rounded-full border-b border-current mr-1" />
                              : <CheckCircle2 className="h-3 w-3 mr-1" />
                            }
                            Trust
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRevoke(entry.id)}
                            disabled={busyId === entry.id}
                            className="h-7 text-xs text-yellow-600 hover:text-yellow-700"
                          >
                            {busyId === entry.id
                              ? <div className="h-3 w-3 animate-spin rounded-full border-b border-current mr-1" />
                              : <ShieldOff className="h-3 w-3 mr-1" />
                            }
                            Revoke
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(entry.id, entry.server_name)}
                          disabled={busyId === entry.id}
                          className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    {/* Stored fingerprint */}
                    <div className="text-xs bg-muted/60 rounded px-3 py-2 font-mono text-muted-foreground break-all">
                      <span className="text-muted-foreground/70 not-italic font-sans mr-2">Stored:</span>
                      {entry.fingerprint ?? <em className="font-sans opacity-60">no fingerprint stored</em>}
                    </div>

                    {/* Scan result */}
                    {scan && (
                      <div
                        className={`text-xs rounded px-3 py-2 border ${
                          !scan.success
                            ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                            : fingerprintMismatch
                            ? 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800'
                            : 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0">
                            {!scan.success ? (
                              <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                            ) : fingerprintMismatch ? (
                              <AlertCircle className="h-3.5 w-3.5 text-yellow-500 shrink-0 mt-0.5" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                            )}
                            <div className="min-w-0">
                              <div className="font-sans font-medium text-foreground mb-0.5">
                                {!scan.success
                                  ? `Scan failed: ${scan.error}`
                                  : fingerprintMismatch
                                  ? 'Fingerprint mismatch — server may have changed'
                                  : 'Fingerprint matches stored value'}
                              </div>
                              {scan.fingerprint && (
                                <div className="font-mono break-all">
                                  <span className="font-sans text-muted-foreground mr-2">Live:</span>
                                  {scan.fingerprint}
                                  {scan.type && <span className="font-sans text-muted-foreground ml-2">({scan.type})</span>}
                                </div>
                              )}
                            </div>
                          </div>
                          {scan.success && scan.fingerprint && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleUpdateFingerprint(entry.id, scan.fingerprint!)}
                              disabled={busyId === entry.id}
                              className="h-6 text-xs shrink-0"
                            >
                              Update
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add trust dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Server Trust</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="server_id">Server</Label>
              <select
                id="server_id"
                value={addForm.server_id}
                onChange={(e) => setAddForm((f) => ({ ...f, server_id: e.target.value }))}
                required
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="">Select a server…</option>
                {untrustedServers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.ssh_host ? ` (${s.ssh_host})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fingerprint">Fingerprint <span className="text-muted-foreground text-xs">(optional — can scan later)</span></Label>
              <Input
                id="fingerprint"
                placeholder="SHA256:..."
                value={addForm.fingerprint}
                onChange={(e) => setAddForm((f) => ({ ...f, fingerprint: e.target.value }))}
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                id="notes"
                placeholder="e.g. Primary Proxmox node"
                value={addForm.notes}
                onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

            {addError && (
              <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">{addError}</p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAdd(false)} disabled={adding}>
                Cancel
              </Button>
              <Button type="submit" disabled={adding || !addForm.server_id}>
                {adding && <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-primary-foreground mr-2" />}
                Add Trust Entry
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
