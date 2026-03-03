/**
 * Add new server form page.
 * Creates a new Proxmox or PBS server entry.
 */

import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useApiMutation } from '../hooks/useApi';
import { ArrowLeft, Server, Eye, EyeOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// ─── Types ────────────────────────────────────────────────────────────────────

type ServerType = 'pve' | 'pbs';

interface FormState {
  name: string;
  type: ServerType;
  url: string;
  group_name: string;
  ssh_host: string;
  ssh_port: string;
  ssh_user: string;
  ssh_key: string;
  auth_token: string;
  ssl_fingerprint: string;
}

// ─── Form field helpers ───────────────────────────────────────────────────────

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  required,
  fontMono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  fontMono?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      className={`w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary ${fontMono ? 'font-mono' : ''}`}
    />
  );
}

// ─── ServerNew page ───────────────────────────────────────────────────────────

export default function ServerNewPage() {
  const navigate = useNavigate();
  const { mutate, loading, error } = useApiMutation();
  const [showKey, setShowKey] = useState(false);

  const [form, setForm] = useState<FormState>({
    name: '',
    type: 'pve',
    url: '',
    group_name: '',
    ssh_host: '',
    ssh_port: '22',
    ssh_user: 'root',
    ssh_key: '',
    auth_token: '',
    ssl_fingerprint: '',
  });

  function set(field: keyof FormState) {
    return (value: string) => setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const result = await mutate<{ id: number }>('/api/servers', {
        name: form.name,
        type: form.type,
        url: form.url,
        group_name: form.group_name || null,
        ssh_host: form.ssh_host || null,
        ssh_port: parseInt(form.ssh_port) || 22,
        ssh_user: form.ssh_user || 'root',
        ssh_key: form.ssh_key || null,
        auth_token: form.auth_token || null,
        ssl_fingerprint: form.ssl_fingerprint || null,
      });
      if (result?.id) {
        navigate(`/servers/${result.id}`);
      } else {
        navigate('/servers');
      }
    } catch { /* error shown below */ }
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
          <p className="text-sm text-muted-foreground">Connect a new Proxmox VE or PBS node</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic info */}
        <Card className="border-muted/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              Basic Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Display Name" required>
                <TextInput
                  value={form.name}
                  onChange={set('name')}
                  placeholder="e.g. pve-01"
                  required
                />
              </Field>
              <Field label="Server Type" required>
                <div className="flex gap-2">
                  {(['pve', 'pbs'] as ServerType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => set('type')(t)}
                      className={`flex-1 py-2 px-3 rounded-md border text-sm font-medium transition-all ${
                        form.type === t
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-input hover:bg-muted'
                      }`}
                    >
                      {t.toUpperCase()}
                      <Badge variant="outline" className="ml-2 text-[9px] py-0">
                        {t === 'pve' ? 'Hypervisor' : 'Backup'}
                      </Badge>
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <Field label="API URL" required hint="e.g. https://192.168.1.10:8006">
              <TextInput
                value={form.url}
                onChange={set('url')}
                placeholder="https://192.168.1.10:8006"
                required
                fontMono
              />
            </Field>
            <Field label="Group / Cluster Name" hint="Optional — for organizing multiple nodes">
              <TextInput
                value={form.group_name}
                onChange={set('group_name')}
                placeholder="e.g. Production Cluster"
              />
            </Field>
            <Field label="SSL Fingerprint" hint="Optional — skip TLS verification if not set">
              <TextInput
                value={form.ssl_fingerprint}
                onChange={set('ssl_fingerprint')}
                placeholder="AA:BB:CC:..."
                fontMono
              />
            </Field>
          </CardContent>
        </Card>

        {/* Auth */}
        <Card className="border-muted/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Proxmox API Token</CardTitle>
            <CardDescription className="text-xs">
              Used for Proxmox API calls. Format: user@realm!tokenid=secret
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Field label="API Token" hint="e.g. root@pam!reanimator=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx">
              <TextInput
                value={form.auth_token}
                onChange={set('auth_token')}
                placeholder="root@pam!reanimator=xxxxxxxx-xxxx-..."
                fontMono
              />
            </Field>
          </CardContent>
        </Card>

        {/* SSH */}
        <Card className="border-muted/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">SSH Connection</CardTitle>
            <CardDescription className="text-xs">
              Used for agentless management — config backups, command execution
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <Field label="SSH Host" hint="IP address or hostname">
                  <TextInput
                    value={form.ssh_host}
                    onChange={set('ssh_host')}
                    placeholder="192.168.1.10"
                    fontMono
                  />
                </Field>
              </div>
              <Field label="Port">
                <TextInput
                  value={form.ssh_port}
                  onChange={set('ssh_port')}
                  placeholder="22"
                  type="number"
                />
              </Field>
            </div>
            <Field label="SSH User">
              <TextInput
                value={form.ssh_user}
                onChange={set('ssh_user')}
                placeholder="root"
              />
            </Field>
            <Field label="SSH Private Key" hint="Paste the private key content (PEM format). Leave empty to use the system default key.">
              <div className="relative">
                <textarea
                  value={form.ssh_key}
                  onChange={(e) => set('ssh_key')(e.target.value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                  rows={showKey ? 6 : 2}
                  className="w-full px-3 py-2 text-xs font-mono rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
          </CardContent>
        </Card>

        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={loading || !form.name || !form.url}>
            {loading ? 'Adding...' : 'Add Server'}
          </Button>
          <Link to="/servers">
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
