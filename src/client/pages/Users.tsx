/**
 * User management page for the React SPA.
 * Admin-only: fetches /api/users and provides CRUD actions.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi, apiCall } from '../hooks/useApi';
import { Plus, Trash2, Shield, User, RefreshCw, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface UserItem {
  id: number;
  username: string;
  email: string | null;
  is_admin: boolean;
  is_active: boolean;
  force_password_change: boolean;
  created_at: string;
  last_login: string | null;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return 'Never';
  try {
    return new Intl.DateTimeFormat('de', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(dateString));
  } catch {
    return dateString;
  }
}

export default function UsersPage() {
  const { t } = useTranslation('users');
  const { data: users, loading, error, refetch } = useApi<UserItem[]>('/api/users');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', password: '', email: '', is_admin: false });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      await apiCall('/api/users', { method: 'POST', body: JSON.stringify(createForm) });
      setShowCreate(false);
      setCreateForm({ username: '', password: '', email: '', is_admin: false });
      refetch();
    } catch (e: any) {
      setCreateError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: number, username: string) {
    if (!confirm(`Delete user "${username}"?`)) return;
    setDeletingId(id);
    try {
      await apiCall(`/api/users/${id}`, { method: 'DELETE' });
      refetch();
    } catch (e: any) {
      alert(`Failed: ${e.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggleAdmin(user: UserItem) {
    try {
      await apiCall(`/api/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_admin: !user.is_admin }),
      });
      refetch();
    } catch (e: any) {
      alert(`Failed: ${e.message}`);
    }
  }

  async function handleToggleActive(user: UserItem) {
    try {
      await apiCall(`/api/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !user.is_active }),
      });
      refetch();
    } catch (e: any) {
      alert(`Failed: ${e.message}`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title', 'Users')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle', 'Manage access and permissions')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('addUser', 'Add User')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{error}</div>
      )}

      {loading && !users && (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">{users?.length ?? 0} users</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border/50">
            {(users || []).map((user) => (
              <div key={user.id} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="bg-muted p-2 rounded-full">
                    {user.is_admin ? <Shield className="h-4 w-4 text-primary" /> : <User className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{user.username}</span>
                      {user.is_admin && <Badge variant="default" className="text-[10px] py-0">Admin</Badge>}
                      {!user.is_active && <Badge variant="destructive" className="text-[10px] py-0">Inactive</Badge>}
                      {user.force_password_change && <Badge variant="secondary" className="text-[10px] py-0">Must change pw</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {user.email || 'No email'} &bull; Last login: {formatDate(user.last_login)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => handleToggleAdmin(user)}
                    title={user.is_admin ? 'Remove admin' : 'Make admin'}
                  >
                    <Shield className={`h-3.5 w-3.5 ${user.is_admin ? 'text-primary' : 'text-muted-foreground'}`} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => handleToggleActive(user)}
                    title={user.is_active ? 'Deactivate' : 'Activate'}
                  >
                    {user.is_active ? <Check className="h-3.5 w-3.5 text-green-500" /> : <X className="h-3.5 w-3.5 text-red-500" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDelete(user.id, user.username)}
                    disabled={deletingId === user.id}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Create user dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('addUser', 'Add User')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Username</Label>
              <Input
                required
                value={createForm.username}
                onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="username"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                required
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <Label>Email (optional)</Label>
              <Input
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="user@example.com"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_admin"
                checked={createForm.is_admin}
                onChange={(e) => setCreateForm((f) => ({ ...f, is_admin: e.target.checked }))}
                className="h-4 w-4"
              />
              <Label htmlFor="is_admin">Administrator</Label>
            </div>
            {createError && (
              <p className="text-sm text-destructive">{createError}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={creating}>
                {creating && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground mr-2" />}
                Create User
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
