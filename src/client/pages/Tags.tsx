/**
 * Tag management page.
 * Shows all tags with colored badges, add and delete.
 */

import React, { useState } from 'react';
import { useApi, useApiMutation } from '../hooks/useApi';
import { Tag, Plus, Trash2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TagItem {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

// ─── Preset colors ────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  '3b82f6', // blue
  '10b981', // green
  'f59e0b', // amber
  'ef4444', // red
  '8b5cf6', // violet
  'ec4899', // pink
  '06b6d4', // cyan
   'f97316', // orange
  '6b7280', // gray
  '14b8a6', // teal
];

// ─── Tags page ────────────────────────────────────────────────────────────────

export default function TagsPage() {
  const { data: tags, loading, error, refetch } = useApi<TagItem[]>('/api/tags');
  const { mutate } = useApiMutation();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleDelete(id: number) {
    setDeletingId(id);
    setPendingDelete(null);
    try {
      await mutate(`/api/tags/${id}`, undefined, 'DELETE');
      refetch();
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) { setFormError('Name is required'); return; }
    setCreating(true);
    setFormError(null);
    try {
      await mutate('/api/tags', { name: newName.trim(), color: newColor });
      setNewName('');
      setNewColor(PRESET_COLORS[0]);
      setShowForm(false);
      refetch();
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Tags</h1>
            <p className="text-sm text-muted-foreground">
              Manage tags for organizing VMs and containers
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button size="sm" onClick={() => setShowForm(!showForm)}>
              <Plus className="mr-2 h-4 w-4" />
              New Tag
            </Button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Create form */}
        {showForm && (
          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Create New Tag</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Tag Name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. production"
                    className="w-full max-w-sm px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-2">Color</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setNewColor(color)}
                        className={`w-6 h-6 rounded-full border-2 transition-all ${newColor === color ? 'border-foreground scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: `#${color}` }}
                        title={`#${color}`}
                      />
                    ))}
                    <input
                      type="color"
                      value={`#${newColor}`}
                      onChange={(e) => setNewColor(e.target.value.replace('#', ''))}
                      className="w-6 h-6 rounded cursor-pointer border border-input bg-background"
                      title="Custom color"
                    />
                    {/* Preview */}
                    {newName && (
                      <Badge
                        className="ml-2 text-white"
                        style={{ backgroundColor: `#${newColor}` }}
                      >
                        {newName}
                      </Badge>
                    )}
                  </div>
                </div>
                {formError && (
                  <p className="text-xs text-destructive">{formError}</p>
                )}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={creating}>
                    {creating ? 'Creating...' : 'Create Tag'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { setShowForm(false); setFormError(null); setNewName(''); }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Loading */}
        {loading && !tags && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {/* Empty state */}
        {!loading && tags && tags.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
              <Tag className="h-12 w-12 text-muted-foreground/50" />
              <div className="text-center space-y-1">
                <p className="font-medium">No tags yet</p>
                <p className="text-sm text-muted-foreground">
                  Create tags to organize your VMs and containers.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tags table */}
        {tags && tags.length > 0 && (
          <Card className="border-muted/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">All Tags ({tags.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {tags.map((tag) => (
                  <div
                    key={tag.id}
                    className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-4 h-4 rounded-full shrink-0 border border-black/10"
                        style={{ backgroundColor: `#${tag.color}` }}
                      />
                      <span className="text-sm font-medium">{tag.name}</span>
                      <code className="text-[10px] text-muted-foreground">#{tag.color}</code>
                    </div>
                    <div className="flex items-center gap-2">
                      {pendingDelete === tag.id ? (
                        <>
                          <span className="text-xs text-muted-foreground">Confirm delete?</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setPendingDelete(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={deletingId === tag.id}
                            onClick={() => handleDelete(tag.id)}
                          >
                            Delete
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          disabled={deletingId === tag.id}
                          onClick={() => setPendingDelete(tag.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
