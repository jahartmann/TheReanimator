/**
 * Add new server form.
 * Proxmox tab: SSH test with auto-fingerprint + API token generator + cluster detection.
 * Linux tab: Generic SSH-only server.
 * Raise Undead tab: Automated SSH key setup via root password.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiCall } from '../hooks/useApi';
import {
  ArrowLeft, Save, Key, Network, Plus, Skull, Eye, EyeOff, CheckCircle2, XCircle, Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// ─── Shared field helpers ─────────────────────────────────────────────────────

function Field({
  label, required, hint, children,
}: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function TextInput({
  value, onChange, placeholder, type = 'text', required, fontMono, rows,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  type?: string; required?: boolean; fontMono?: boolean; rows?: number;
}) {
  const cls = `w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary ${fontMono ? 'font-mono' : ''}`;
  if (rows) {
    return (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={`${cls} resize-none text-xs`}
      />
    );
  }
  return (
    <input
      type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} required={required} className={cls}
    />
  );
}

// ─── Proxmox Tab ──────────────────────────────────────────────────────────────

interface ProxmoxForm {
  name: string; type: 'pve' | 'pbs'; url: string; group_name: string;
  ssh_host: string; ssh_port: string; ssh_user: string; ssh_password: string; ssh_key: string;
  auth_token: string; ssl_fingerprint: string;
  pm_user: string; pm_pass: string;
}

function ProxmoxTab({ onSuccess }: { onSuccess: (id: number) => void }) {
  const [form, setForm] = useState<ProxmoxForm>({
    name: '', type: 'pve', url: '', group_name: '',
    ssh_host: '', ssh_port: '22', ssh_user: 'root', ssh_password: '', ssh_key: '',
    auth_token: '', ssl_fingerprint: '',
    pm_user: 'root@pam', pm_pass: '',
  });
  const [showKey, setShowKey] = useState(false);
  const [groups, setGroups] = useState<string[]>([]);
  const [isNewGroup, setIsNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const [sshStatus, setSshStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [sshMsg, setSshMsg] = useState('');
  const [tokenStatus, setTokenStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [tokenMsg, setTokenMsg] = useState('');
  const [clusterNodes, setClusterNodes] = useState<{ name: string; ip: string }[]>([]);
  const [importCluster, setImportCluster] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  function set(field: keyof ProxmoxForm) {
    return (value: string) => setForm(p => ({ ...p, [field]: value }));
  }

  // Load existing groups for the picker
  useEffect(() => {
    apiCall<{ id: number; group_name: string | null }[]>('/api/servers')
      .then(servers => {
        const gs = Array.from(new Set(servers.filter(s => s.group_name).map(s => s.group_name!)));
        setGroups(gs);
      })
      .catch(() => {});
  }, []);

  async function handleTestSSH() {
    if (!form.ssh_host) { setSshMsg('SSH Host required'); setSshStatus('error'); return; }
    setSshStatus('loading'); setSshMsg('Connecting…');
    try {
      const res = await apiCall<{ success: boolean; message: string; fingerprint?: string; clusterNodes?: { name: string; ip: string }[] }>(
        '/api/servers/test-ssh', {
          method: 'POST',
          body: JSON.stringify({
            ssh_host: form.ssh_host,
            ssh_port: form.ssh_port,
            ssh_user: form.ssh_user,
            ssh_password: form.ssh_password || form.ssh_key || undefined,
          }),
        },
      );
      setSshStatus(res.success ? 'success' : 'error');
      setSshMsg(res.message);
      if (res.success) {
        if (res.fingerprint) setForm(p => ({ ...p, ssl_fingerprint: res.fingerprint! }));
        if (res.clusterNodes && res.clusterNodes.length > 1) {
          setClusterNodes(res.clusterNodes);
          setImportCluster(true);
        }
      }
    } catch (e: any) {
      setSshStatus('error'); setSshMsg(e.message);
    }
  }

  async function handleGenToken() {
    if (!form.url || !form.pm_user || !form.pm_pass) {
      setTokenMsg('URL, user and password required'); setTokenStatus('error'); return;
    }
    setTokenStatus('loading'); setTokenMsg('Generating…');
    try {
      const res = await apiCall<{ success: boolean; token?: string; message?: string }>(
        '/api/servers/generate-token', {
          method: 'POST',
          body: JSON.stringify({ url: form.url, user: form.pm_user, password: form.pm_pass, type: form.type }),
        },
      );
      if (res.success && res.token) {
        setForm(p => ({ ...p, auth_token: res.token! }));
        setTokenStatus('success'); setTokenMsg('Token generated and applied!');
      } else {
        setTokenStatus('error'); setTokenMsg(res.message || 'Failed');
      }
    } catch (e: any) {
      setTokenStatus('error'); setTokenMsg(e.message);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true); setSubmitError('');
    const groupValue = isNewGroup ? newGroupName.trim() : form.group_name;
    try {
      if (importCluster && clusterNodes.length > 1) {
        // Add all cluster nodes
        let lastId: number | undefined;
        for (const node of clusterNodes) {
          const nodeUrl = `https://${node.ip}:8006`;
          const r = await apiCall<{ id: number }>('/api/servers', {
            method: 'POST',
            body: JSON.stringify({
              name: node.name, type: form.type, url: nodeUrl,
              ssh_host: node.ip, ssh_port: parseInt(form.ssh_port) || 22,
              ssh_user: form.ssh_user, ssh_key: form.ssh_password || form.ssh_key || null,
              group_name: groupValue || null,
              auth_token: form.auth_token || null,
              ssl_fingerprint: form.ssl_fingerprint || null,
            }),
          });
          lastId = r.id;
        }
        onSuccess(lastId!);
      } else {
        const r = await apiCall<{ id: number }>('/api/servers', {
          method: 'POST',
          body: JSON.stringify({
            name: form.name, type: form.type, url: form.url,
            ssh_host: form.ssh_host || null, ssh_port: parseInt(form.ssh_port) || 22,
            ssh_user: form.ssh_user, ssh_key: form.ssh_password || form.ssh_key || null,
            group_name: groupValue || null,
            auth_token: form.auth_token || null,
            ssl_fingerprint: form.ssl_fingerprint || null,
          }),
        });
        onSuccess(r.id);
      }
    } catch (e: any) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const sshIcon = sshStatus === 'loading' ? <Loader2 className="h-3 w-3 animate-spin" />
    : sshStatus === 'success' ? <CheckCircle2 className="h-3 w-3 text-green-500" />
    : sshStatus === 'error' ? <XCircle className="h-3 w-3 text-destructive" /> : null;

  const tokenIcon = tokenStatus === 'loading' ? <Loader2 className="h-3 w-3 animate-spin" />
    : tokenStatus === 'success' ? <CheckCircle2 className="h-3 w-3 text-green-500" />
    : tokenStatus === 'error' ? <XCircle className="h-3 w-3 text-destructive" /> : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic info */}
      <Card className="border-muted/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Basic Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Display Name" required>
              <TextInput value={form.name} onChange={set('name')} placeholder="pve-01" required />
            </Field>
            <Field label="Server Type" required>
              <div className="flex gap-2">
                {(['pve', 'pbs'] as const).map(t => (
                  <button key={t} type="button" onClick={() => set('type')(t)}
                    className={`flex-1 py-2 px-3 rounded-md border text-sm font-medium transition-all ${form.type === t ? 'border-primary bg-primary/5 text-primary' : 'border-input hover:bg-muted'}`}>
                    {t.toUpperCase()}
                    <Badge variant="outline" className="ml-2 text-[9px] py-0">{t === 'pve' ? 'Hypervisor' : 'Backup'}</Badge>
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <Field label="API URL" required hint="e.g. https://192.168.1.10:8006">
            <TextInput value={form.url} onChange={set('url')} placeholder="https://192.168.1.10:8006" required fontMono />
          </Field>

          <Field label="Group / Cluster Name" hint="Optional — for organizing multiple nodes">
            {isNewGroup ? (
              <div className="flex gap-2">
                <TextInput value={newGroupName} onChange={setNewGroupName} placeholder="New group name…" />
                <Button type="button" variant="ghost" size="sm" onClick={() => { setIsNewGroup(false); setNewGroupName(''); }}>Cancel</Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select value={form.group_name} onChange={e => set('group_name')(e.target.value)}
                  className="flex-1 h-9 px-3 text-sm rounded-md border border-input bg-background">
                  <option value="">No group</option>
                  {groups.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <Button type="button" variant="outline" size="icon" onClick={() => setIsNewGroup(true)} title="Create new group">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}
          </Field>
        </CardContent>
      </Card>

      {/* API Token Generator */}
      <Card className="border-muted/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Key className="h-4 w-4 text-primary" />
            Proxmox API Token
          </CardTitle>
          <CardDescription className="text-xs">
            Enter Proxmox credentials to auto-generate an API token, or paste one manually.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-muted/40 rounded-lg border space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Auto-generate token from credentials</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Proxmox User">
                <TextInput value={form.pm_user} onChange={set('pm_user')} placeholder="root@pam" fontMono />
              </Field>
              <Field label="Password">
                <TextInput value={form.pm_pass} onChange={set('pm_pass')} type="password" placeholder="••••••••" />
              </Field>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={handleGenToken} disabled={tokenStatus === 'loading'}>
                {tokenIcon}<span className="ml-1">Generate Token</span>
              </Button>
              {tokenMsg && (
                <span className={`text-xs ${tokenStatus === 'success' ? 'text-green-600' : 'text-destructive'}`}>{tokenMsg}</span>
              )}
            </div>
          </div>

          <Field label="API Token" hint="Format: user@realm!tokenid=secret — e.g. root@pam!reanimator=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx">
            <TextInput value={form.auth_token} onChange={set('auth_token')} placeholder="root@pam!reanimator=…" fontMono />
          </Field>

          <Field label="SSL Fingerprint" hint="Auto-filled when you test the SSH connection below. Or leave empty to skip TLS verification.">
            <TextInput value={form.ssl_fingerprint} onChange={set('ssl_fingerprint')} placeholder="AA:BB:CC:…" fontMono />
          </Field>
        </CardContent>
      </Card>

      {/* SSH */}
      <Card className="border-muted/60">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium">SSH Connection</CardTitle>
              <CardDescription className="text-xs mt-1">
                Used for agentless management. Testing will auto-fill the SSL fingerprint.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {sshMsg && (
                <span className={`text-xs flex items-center gap-1 ${sshStatus === 'success' ? 'text-green-600' : 'text-destructive'}`}>
                  {sshIcon}{sshMsg}
                </span>
              )}
              <Button type="button" size="sm" variant="secondary" onClick={handleTestSSH} disabled={sshStatus === 'loading'}>
                <Network className="mr-1.5 h-3 w-3" />
                Test Connection
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Field label="SSH Host">
                <TextInput value={form.ssh_host} onChange={set('ssh_host')} placeholder="192.168.1.10" fontMono />
              </Field>
            </div>
            <Field label="Port">
              <TextInput value={form.ssh_port} onChange={set('ssh_port')} placeholder="22" type="number" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="SSH User">
              <TextInput value={form.ssh_user} onChange={set('ssh_user')} placeholder="root" />
            </Field>
            <Field label="SSH Password" hint="For testing and one-time setup only">
              <TextInput value={form.ssh_password} onChange={set('ssh_password')} type="password" placeholder="••••••••" />
            </Field>
          </div>
          <Field label="SSH Private Key" hint="Paste PEM key content. Leave empty to use system default key.">
            <div className="relative">
              <TextInput value={form.ssh_key} onChange={set('ssh_key')}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                fontMono rows={showKey ? 6 : 2} />
              <button type="button" onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground">
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>

          {/* Cluster detection */}
          {clusterNodes.length > 1 && (
            <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg space-y-3">
              <div className="flex items-start gap-3">
                <Network className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
                <div className="space-y-2 flex-1">
                  <h4 className="font-medium text-sm text-blue-500">Cluster detected!</h4>
                  <p className="text-xs text-muted-foreground">
                    Found {clusterNodes.length} nodes. Import all of them automatically?
                  </p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={importCluster} onChange={e => setImportCluster(e.target.checked)}
                      className="h-4 w-4 rounded" />
                    <span className="text-sm font-medium">Import all {clusterNodes.length} cluster nodes</span>
                  </label>
                  {importCluster && (
                    <div className="text-xs font-mono bg-background/50 p-2 rounded border border-blue-500/10">
                      {clusterNodes.map(n => (
                        <div key={n.name} className="flex justify-between py-0.5">
                          <span>{n.name}</span>
                          <span className="text-muted-foreground">{n.ip}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {submitError && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{submitError}</div>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting || !form.name || !form.url}>
          {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Adding…</> : <><Save className="mr-2 h-4 w-4" />Add Server</>}
        </Button>
        <Link to="/servers">
          <Button type="button" variant="outline">Cancel</Button>
        </Link>
      </div>
    </form>
  );
}

// ─── Linux Tab ────────────────────────────────────────────────────────────────

function LinuxTab({ onSuccess }: { onSuccess: (id: number) => void }) {
  const [form, setForm] = useState({ name: '', hostname: '', port: '22', username: 'root', ssh_key_path: '', description: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  function set(field: string) { return (v: string) => setForm(p => ({ ...p, [field]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSubmitting(true); setError('');
    try {
      // Add as a generic linux server (type='linux')
      const r = await apiCall<{ id: number }>('/api/servers', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          type: 'linux',
          url: `ssh://${form.hostname}`,
          ssh_host: form.hostname,
          ssh_port: parseInt(form.port) || 22,
          ssh_user: form.username,
          ssh_key: form.ssh_key_path || null,
          group_name: null,
          auth_token: null,
          ssl_fingerprint: null,
        }),
      });
      onSuccess(r.id);
    } catch (e: any) { setError(e.message); } finally { setSubmitting(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="border-muted/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Generic Linux Server</CardTitle>
          <CardDescription className="text-xs">
            Monitor and manage any Linux system via SSH — Raspberry Pi, VPS, Ubuntu, Debian, CentOS…
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Display Name" required>
              <TextInput value={form.name} onChange={set('name')} placeholder="My Pi 4" required />
            </Field>
            <Field label="Description">
              <TextInput value={form.description} onChange={set('description')} placeholder="Optional…" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Field label="Hostname / IP" required>
                <TextInput value={form.hostname} onChange={set('hostname')} placeholder="192.168.1.50" required fontMono />
              </Field>
            </div>
            <Field label="SSH Port">
              <TextInput value={form.port} onChange={set('port')} placeholder="22" type="number" />
            </Field>
          </div>
          <Field label="SSH Username">
            <TextInput value={form.username} onChange={set('username')} placeholder="root" />
          </Field>
          <Field label="Private Key Path (on server)" hint="Path on the machine running Reanimator. Empty = use default (~/.ssh/id_rsa).">
            <TextInput value={form.ssh_key_path} onChange={set('ssh_key_path')} placeholder="/home/user/.ssh/id_rsa" fontMono />
          </Field>
        </CardContent>
      </Card>

      {error && <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{error}</div>}

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting || !form.name || !form.hostname}>
          {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Adding…</> : <><Save className="mr-2 h-4 w-4" />Add Server</>}
        </Button>
        <Link to="/servers"><Button type="button" variant="outline">Cancel</Button></Link>
      </div>
    </form>
  );
}

// ─── Raise Undead Tab ─────────────────────────────────────────────────────────

function RaiseUndeadTab({ onSuccess }: { onSuccess: (id: number) => void }) {
  const [form, setForm] = useState({ hostname: '', port: '22', username: 'root', root_password: '', description: '' });
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  function set(field: string) { return (v: string) => setForm(p => ({ ...p, [field]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSubmitting(true); setStatus(null);
    try {
      const r = await apiCall<{ success: boolean; error?: string; id?: number }>(
        '/api/servers/raise-undead', {
          method: 'POST',
          body: JSON.stringify({
            hostname: form.hostname, port: parseInt(form.port) || 22,
            username: form.username, rootPassword: form.root_password, description: form.description,
          }),
        },
      );
      if (r.success && r.id) { onSuccess(r.id); }
      else { setStatus({ type: 'error', msg: r.error || 'Ritual failed' }); }
    } catch (e: any) { setStatus({ type: 'error', msg: e.message }); } finally { setSubmitting(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="border-purple-500/40 bg-purple-500/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-purple-700 dark:text-purple-400">
            <Skull className="h-4 w-4" />
            Raise Undead — Server Takeover
          </CardTitle>
          <CardDescription className="text-xs">
            Automatically setup SSH keys using the root password. "I alone can save you from the void."
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Hostname / IP" required>
            <TextInput value={form.hostname} onChange={set('hostname')} placeholder="192.168.1.66" required fontMono />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="SSH Port">
              <TextInput value={form.port} onChange={set('port')} type="number" placeholder="22" />
            </Field>
            <Field label="Username">
              <TextInput value={form.username} onChange={set('username')} placeholder="root" />
            </Field>
          </div>
          <Field label="Root Password" required>
            <TextInput value={form.root_password} onChange={set('root_password')} type="password" placeholder="For one-time key installation…" required />
          </Field>
          <Field label="Description">
            <TextInput value={form.description} onChange={set('description')} placeholder="Resurrected Node…" />
          </Field>
        </CardContent>
      </Card>

      {status && (
        <div className={`p-4 rounded-lg border text-sm ${status.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-700' : 'bg-destructive/10 border-destructive/20 text-destructive'}`}>
          {status.msg}
        </div>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting || !form.hostname || !form.root_password}
          className="bg-purple-600 hover:bg-purple-700 text-white">
          {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Casting Spell…</> : <><Skull className="mr-2 h-4 w-4" />Raise Undead</>}
        </Button>
        <Link to="/servers"><Button type="button" variant="outline">Cancel</Button></Link>
      </div>
    </form>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'proxmox', label: 'Proxmox' },
  { key: 'linux', label: 'Generic Linux' },
  { key: 'undead', label: '💀 Raise Undead', cls: 'text-purple-600 data-active:text-purple-700' },
] as const;

type TabKey = typeof TABS[number]['key'];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ServerNewPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('proxmox');

  function onSuccess(id: number) {
    navigate(id ? `/servers/${id}` : '/servers');
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/servers">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Add Server</h1>
          <p className="text-sm text-muted-foreground">Connect a new Proxmox VE, PBS, or Linux server</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-muted/40 rounded-lg border border-muted w-fit">
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${tab === t.key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'proxmox' && <ProxmoxTab onSuccess={onSuccess} />}
      {tab === 'linux' && <LinuxTab onSuccess={onSuccess} />}
      {tab === 'undead' && <RaiseUndeadTab onSuccess={onSuccess} />}
    </div>
  );
}
