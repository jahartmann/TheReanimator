'use client';

import { useState, useEffect, useMemo } from 'react';
import { getTags, createTag, deleteTag, scanAllClusterTags, Tag, assignTagsToResource } from '@/lib/actions/tags';
import { getServers, Server } from '@/lib/actions/server';
import { getVMs, VirtualMachine } from '@/lib/actions/vm';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, RefreshCw, X, Tag as TagIcon, Server as ServerIcon, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from 'sonner';

type VMWithServer = VirtualMachine & { serverId: number; serverName: string };

function resolveHex(color: string): string {
    const c = (color ?? '').replace('#', '');
    if (c.length === 3) return `#${c[0]}${c[0]}${c[1]}${c[1]}${c[2]}${c[2]}`;
    if (c.length === 6) return `#${c}`;
    return '#6366f1';
}

function TagPill({ tag, onDelete }: { tag: Tag; onDelete?: () => void }) {
    const hex = resolveHex(tag.color);
    return (
        <span
            className="group inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full text-sm font-medium"
            style={{ backgroundColor: `${hex}1a`, color: hex, border: `1px solid ${hex}55` }}
        >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: hex }} />
            {tag.name}
            {onDelete && (
                <button
                    onClick={onDelete}
                    className="opacity-30 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-black/10 rounded-full ml-0.5"
                    title={`${tag.name} löschen`}
                >
                    <X className="h-3 w-3" />
                </button>
            )}
        </span>
    );
}

export default function TagsPage() {
    const [tags, setTags] = useState<Tag[]>([]);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);

    // Create
    const [newName, setNewName] = useState('');
    const [newColor, setNewColor] = useState('#3b82f6');
    const [creating, setCreating] = useState(false);

    // Assign section
    const [showAssign, setShowAssign] = useState(false);
    const [servers, setServers] = useState<Server[]>([]);
    const [allVMs, setAllVMs] = useState<VMWithServer[]>([]);
    const [vmsLoading, setVmsLoading] = useState(false);
    const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());
    const [selectedVMKeys, setSelectedVMKeys] = useState<Set<string>>(new Set());
    const [assigning, setAssigning] = useState(false);

    useEffect(() => {
        loadPage();
    }, []);

    async function loadPage() {
        setLoading(true);
        setScanning(true);
        try {
            // Scan cluster tags in background, then load from DB
            await scanAllClusterTags();
        } catch { /* SSH may not be reachable — that's OK */ }
        try {
            const [tData, sData] = await Promise.all([getTags(), getServers()]);
            setTags(tData);
            setServers(sData);
        } catch {
            toast.error('Fehler beim Laden der Tags');
        } finally {
            setLoading(false);
            setScanning(false);
        }
    }

    async function handleScan() {
        setScanning(true);
        try {
            const res = await scanAllClusterTags();
            if (res.success) {
                toast.success(res.message);
                setTags(await getTags());
            }
        } catch {
            toast.error('Scan fehlgeschlagen');
        } finally {
            setScanning(false);
        }
    }

    async function handleCreate() {
        if (!newName.trim()) return;
        setCreating(true);
        try {
            const res = await createTag(newName.trim(), newColor);
            if (res.success && res.tag) {
                setTags(prev => [...prev, res.tag!].sort((a, b) => a.name.localeCompare(b.name)));
                setNewName('');
                toast.success(`Tag „${res.tag.name}" erstellt`);
            } else {
                toast.error(res.error ?? 'Tag konnte nicht erstellt werden');
            }
        } catch {
            toast.error('Fehler beim Erstellen');
        } finally {
            setCreating(false);
        }
    }

    async function handleDelete(tag: Tag) {
        await deleteTag(tag.id);
        setTags(prev => prev.filter(t => t.id !== tag.id));
        setSelectedTagIds(prev => { const s = new Set(prev); s.delete(tag.id); return s; });
        toast.success(`Tag „${tag.name}" gelöscht`);
    }

    async function loadVMs() {
        if (vmsLoading || allVMs.length > 0) return;
        setVmsLoading(true);
        try {
            const results = await Promise.all(
                servers.map(async s => {
                    try {
                        const vms = await getVMs(s.id);
                        return vms.map(vm => ({ ...vm, serverId: s.id, serverName: s.name }));
                    } catch { return []; }
                })
            );
            setAllVMs(results.flat());
        } finally {
            setVmsLoading(false);
        }
    }

    function toggleAssign() {
        if (!showAssign) loadVMs();
        setShowAssign(v => !v);
    }

    async function handleAssign() {
        if (selectedTagIds.size === 0 || selectedVMKeys.size === 0) {
            toast.error('Bitte Tags und VMs auswählen');
            return;
        }
        setAssigning(true);
        const tagNames = tags.filter(t => selectedTagIds.has(t.id)).map(t => t.name);
        let ok = 0, fail = 0;
        for (const key of selectedVMKeys) {
            const [sid, vmid] = key.split('-');
            try {
                await assignTagsToResource(parseInt(sid), vmid, tagNames);
                ok++;
            } catch { fail++; }
        }
        setAssigning(false);
        toast.success(`${ok} VM(s) getaggt${fail > 0 ? `, ${fail} fehlgeschlagen` : ''}`);
        setSelectedTagIds(new Set());
        setSelectedVMKeys(new Set());
    }

    const vmsByServer = useMemo(() =>
        servers.reduce((acc, s) => {
            acc[s.id] = allVMs.filter(v => v.serverId === s.id);
            return acc;
        }, {} as Record<number, VMWithServer[]>),
        [allVMs, servers]
    );

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <TagIcon className="h-6 w-6 text-primary" />
                        Tag-Verwaltung
                    </h1>
                    <p className="text-sm text-muted-foreground mt-0.5">Proxmox-Tags zentral verwalten und VMs zuweisen</p>
                </div>
                <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${scanning ? 'animate-spin' : ''}`} />
                    {scanning ? 'Scanne…' : 'Cluster scannen'}
                </Button>
            </div>

            {/* Create */}
            <Card>
                <CardContent className="pt-4 pb-4">
                    <div className="flex gap-2 items-center">
                        <input
                            type="color"
                            value={newColor}
                            onChange={e => setNewColor(e.target.value)}
                            className="w-9 h-9 rounded cursor-pointer border border-border p-0.5 bg-transparent shrink-0"
                            title="Farbe wählen"
                        />
                        <Input
                            placeholder="Tag-Name, z.B. production"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleCreate()}
                            className="flex-1"
                        />
                        <Button onClick={handleCreate} disabled={!newName.trim() || creating} size="sm">
                            {creating
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <><Plus className="h-4 w-4 mr-1" />Erstellen</>
                            }
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Tag List */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">
                        Tags
                        {!loading && tags.length > 0 && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">{tags.length} gesamt</span>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {scanning ? 'Scanne Cluster nach Tags…' : 'Lade…'}
                        </div>
                    ) : tags.length === 0 ? (
                        <div className="text-center py-10 text-muted-foreground">
                            <TagIcon className="h-10 w-10 mx-auto mb-3 opacity-20" />
                            <p className="font-medium">Keine Tags gefunden</p>
                            <p className="text-sm mt-1 opacity-70">
                                Klicke auf „Cluster scannen" um Tags aus Proxmox zu laden,<br />
                                oder erstelle manuell einen neuen Tag.
                            </p>
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {tags.map(tag => (
                                <TagPill key={tag.id} tag={tag} onDelete={() => handleDelete(tag)} />
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Assign Section (collapsible) */}
            <Card>
                <CardHeader
                    className="pb-3 cursor-pointer select-none"
                    onClick={toggleAssign}
                >
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-base">Tags VMs zuweisen</CardTitle>
                            <CardDescription className="mt-0.5">
                                Tags direkt einer oder mehreren VMs im Cluster zuweisen
                            </CardDescription>
                        </div>
                        {showAssign ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                </CardHeader>

                {showAssign && (
                    <CardContent className="space-y-5 pt-0">
                        {/* Pick Tags */}
                        <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                1. Tags auswählen
                            </p>
                            {tags.length === 0 ? (
                                <p className="text-sm text-muted-foreground">Keine Tags vorhanden.</p>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {tags.map(tag => {
                                        const hex = resolveHex(tag.color);
                                        const active = selectedTagIds.has(tag.id);
                                        return (
                                            <button
                                                key={tag.id}
                                                onClick={() => {
                                                    const next = new Set(selectedTagIds);
                                                    active ? next.delete(tag.id) : next.add(tag.id);
                                                    setSelectedTagIds(next);
                                                }}
                                                className="inline-flex items-center gap-1.5 pl-3 pr-3 py-1.5 rounded-full text-sm font-medium transition-all"
                                                style={{
                                                    backgroundColor: active ? `${hex}30` : `${hex}0d`,
                                                    color: hex,
                                                    border: `1px solid ${active ? hex : `${hex}40`}`,
                                                    outline: active ? `2px solid ${hex}30` : undefined,
                                                    outlineOffset: '1px',
                                                }}
                                            >
                                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: hex }} />
                                                {tag.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Pick VMs */}
                        <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                2. VMs auswählen
                                {selectedVMKeys.size > 0 && (
                                    <span className="ml-2 normal-case font-normal text-primary">{selectedVMKeys.size} ausgewählt</span>
                                )}
                            </p>
                            {vmsLoading ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Lade VMs…
                                </div>
                            ) : allVMs.length === 0 ? (
                                <p className="text-sm text-muted-foreground">Keine VMs geladen.</p>
                            ) : (
                                <div className="space-y-4 max-h-80 overflow-y-auto pr-1">
                                    {servers.map(server => {
                                        const vms = vmsByServer[server.id] ?? [];
                                        if (vms.length === 0) return null;
                                        return (
                                            <div key={server.id}>
                                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mb-1.5">
                                                    <ServerIcon className="h-3 w-3" />
                                                    {server.name}
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 pl-4">
                                                    {vms.map(vm => {
                                                        const key = `${server.id}-${vm.vmid}`;
                                                        const checked = selectedVMKeys.has(key);
                                                        return (
                                                            <label
                                                                key={key}
                                                                className={`flex items-center gap-2.5 p-2 rounded-md border cursor-pointer text-sm transition-colors ${checked ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/50'}`}
                                                            >
                                                                <Checkbox
                                                                    checked={checked}
                                                                    onCheckedChange={() => {
                                                                        const next = new Set(selectedVMKeys);
                                                                        checked ? next.delete(key) : next.add(key);
                                                                        setSelectedVMKeys(next);
                                                                    }}
                                                                />
                                                                <div className="min-w-0">
                                                                    <p className="font-medium truncate leading-tight">{vm.name}</p>
                                                                    <p className="text-[10px] text-muted-foreground">{vm.vmid} · {vm.status}</p>
                                                                </div>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Action */}
                        <div className="flex justify-end pt-2 border-t">
                            <Button
                                onClick={handleAssign}
                                disabled={assigning || selectedTagIds.size === 0 || selectedVMKeys.size === 0}
                            >
                                {assigning
                                    ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    : <TagIcon className="h-4 w-4 mr-2" />
                                }
                                {selectedTagIds.size > 0 && selectedVMKeys.size > 0
                                    ? `${selectedTagIds.size} Tag(s) → ${selectedVMKeys.size} VM(s) zuweisen`
                                    : 'Tags zuweisen'
                                }
                            </Button>
                        </div>
                    </CardContent>
                )}
            </Card>
        </div>
    );
}
