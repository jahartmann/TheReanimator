'use client';

import { useState, useEffect, useMemo } from 'react';
import { getTags, createTag, deleteTag, scanAllClusterTags, Tag, pushTagsToServer, assignTagsToResource } from '@/app/actions/tags';
import { getServers, Server } from '@/app/actions/server';
import { getVMs, VirtualMachine } from '@/app/actions/vm';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, RefreshCw, Trash2, Tag as TagIcon, Server as ServerIcon, Calculator, Search, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from 'sonner';


// Helper for better contrast
function getContrastColor(hexColor: string) {
    if (!hexColor) return 'black';
    let hex = hexColor.replace('#', '');

    // Handle short hex
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }

    if (hex.length !== 6) return 'black'; // Fallback

    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Calculate relative luminance for better accessibility
    // (Rec. 709)
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 150) ? '#000000' : '#ffffff'; // Threshold higher than 128 to prefer black on mid-tones
}

export default function TagsPage() {
    const [tags, setTags] = useState<Tag[]>([]);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);

    // Create Tag
    const [newTagName, setNewTagName] = useState('');
    const [newTagColor, setNewTagColor] = useState('#3b82f6');

    // Assignment
    const [servers, setServers] = useState<Server[]>([]);
    const [allVMs, setAllVMs] = useState<(VirtualMachine & { serverId: number, serverName: string })[]>([]);
    const [selectedVMs, setSelectedVMs] = useState<Set<string>>(new Set()); // "serverId-vmid"
    const [selectedTags, setSelectedTags] = useState<Set<number>>(new Set());
    const [assigning, setAssigning] = useState(false);

    // Search filters
    const [tagSearch, setTagSearch] = useState('');
    const [vmSearch, setVmSearch] = useState('');

    useEffect(() => {
        loadData();
        // Automatic Cluster Sync on Visit
        handleScan(true);
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const [tData, sData] = await Promise.all([
                getTags(),
                getServers()
            ]);
            setTags(tData);
            setServers(sData);

            // Fetch VMs for all servers
            const vmPromises = sData.map(async s => {
                try {
                    const vms = await getVMs(s.id);
                    return vms.map(vm => ({ ...vm, serverId: s.id, serverName: s.name }));
                } catch {
                    return [];
                }
            });
            const vmsFlat = (await Promise.all(vmPromises)).flat();
            setAllVMs(vmsFlat);

        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleScan(silent = false) {
        setScanning(true);
        try {
            const res = await scanAllClusterTags();
            if (res.success) {
                if (!silent) toast.success(res.message);
                const tData = await getTags();
                setTags(tData);
            }
        } catch (e) {
            if (!silent) toast.error('Scan failed');
        } finally {
            setScanning(false);
        }
    }

    async function handleCreateTag() {
        if (!newTagName) return;
        try {
            const res = await createTag(newTagName, newTagColor);
            if (res.success) {
                setNewTagName('');
                loadData(); // Reload tags
            } else {
                alert(res.error);
            }
        } catch (e) {
            console.error(e);
        }
    }

    async function handleDeleteTag(id: number) {
        if (!confirm('Tag löschen?')) return;
        await deleteTag(id);
        loadData();
    }

    const toggleVM = (key: string) => {
        const next = new Set(selectedVMs);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setSelectedVMs(next);
    };

    const toggleTagSelection = (id: number) => {
        const next = new Set(selectedTags);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedTags(next);
    }

    async function handleAssign() {
        if (selectedVMs.size === 0 || selectedTags.size === 0) return alert('Bitte VMs und Tags wählen');
        if (!confirm(`${selectedTags.size} Tags an ${selectedVMs.size} VMs zuweisen?`)) return;

        setAssigning(true);
        const tagNames = tags.filter(t => selectedTags.has(t.id)).map(t => t.name);

        // Group by server
        const tasks: { serverId: number, vmid: string }[] = [];
        selectedVMs.forEach(key => {
            const [sid, vmid] = key.split('-');
            tasks.push({ serverId: parseInt(sid), vmid });
        });

        const results = [];
        for (const task of tasks) {
            try {
                await assignTagsToResource(task.serverId, task.vmid, tagNames);
                results.push(`OK: ${task.vmid}`);
            } catch (e) {
                results.push(`Error: ${task.vmid}`);
            }
        }

        // Push colors to servers too?
        // Maybe optional.

        setAssigning(false);
        alert('Zugewiesen!\n' + results.join('\n'));
        setSelectedVMs(new Set());
        setSelectedTags(new Set());
    }

    // Filtered tags and VMs for search
    const filteredTags = useMemo(() => {
        if (!tagSearch.trim()) return tags;
        const q = tagSearch.toLowerCase();
        return tags.filter(t => t.name.toLowerCase().includes(q));
    }, [tags, tagSearch]);

    const filteredVMs = useMemo(() => {
        if (!vmSearch.trim()) return allVMs;
        const q = vmSearch.toLowerCase();
        return allVMs.filter(vm =>
            vm.name?.toLowerCase().includes(q) ||
            vm.vmid.toString().includes(q) ||
            vm.serverName.toLowerCase().includes(q)
        );
    }, [allVMs, vmSearch]);

    // Group VMs by server for display
    const vmsByServer = servers.reduce((acc, s) => {
        acc[s.id] = filteredVMs.filter(v => v.serverId === s.id);
        return acc;
    }, {} as Record<number, typeof allVMs>);


    return (
        <div className="container mx-auto py-8">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold">Tag Management</h1>
                    <p className="text-muted-foreground">Zentrale Verwaltung aller Proxmox Tags</p>
                </div>
                <Button onClick={() => handleScan(false)} disabled={scanning} variant="outline">
                    <RefreshCw className={`mr-2 h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
                    Cluster Scan
                </Button>

            </div>

            <Tabs defaultValue="manage">
                {/* ... (rest of tabs) ... */}
                <TabsList>
                    <TabsTrigger value="manage">Tags Verwalten</TabsTrigger>
                    <TabsTrigger value="assign">Zuweisen</TabsTrigger>
                </TabsList>

                {/* MANAGE TAB */}
                <TabsContent value="manage" className="space-y-6">
                    <Card>
                        <CardHeader><CardTitle>Neuen Tag erstellen</CardTitle></CardHeader>
                        <CardContent>
                            <div className="flex gap-4 items-end">
                                <div className="space-y-2 flex-1">
                                    <Label>Name</Label>
                                    <Input value={newTagName} onChange={e => setNewTagName(e.target.value)} placeholder="z.B. production" />
                                </div>
                                <div className="space-y-2 w-32">
                                    <Label>Farbe</Label>
                                    <div className="flex gap-2">
                                        <Input type="color" value={newTagColor} onChange={e => setNewTagColor(e.target.value)} className="w-12 p-1" />
                                        <Input value={newTagColor} onChange={e => setNewTagColor(e.target.value)} />
                                    </div>
                                </div>
                                <Button onClick={handleCreateTag} disabled={!newTagName}>
                                    <Plus className="mr-2 h-4 w-4" /> Erstellen
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Tag</TableHead>
                                        <TableHead>Farbe</TableHead>
                                        <TableHead className="text-right">Aktionen</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {tags.map(tag => (
                                        <TableRow key={tag.id}>
                                            <TableCell>
                                                <Badge style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }} className="hover:opacity-90 border shadow-sm">
                                                    {tag.name}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: tag.color }} />
                                                    <span className="font-mono text-xs">{tag.color}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="sm" onClick={() => handleDeleteTag(tag.id)}>
                                                    <Trash2 className="h-4 w-4 text-red-500" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {tags.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                                                Keine Tags gefunden. Starten Sie einen Scan.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ASSIGN TAB */}
                <TabsContent value="assign" className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* 1. Select Tags */}
                        <Card className="lg:col-span-1 h-[600px] flex flex-col">
                            <CardHeader><CardTitle>1. Tags wählen</CardTitle></CardHeader>
                            <CardContent className="flex-1 overflow-auto p-4 pt-0">
                                <div className="space-y-2">
                                    {tags.map(tag => (
                                        <div
                                            key={tag.id}
                                            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedTags.has(tag.id) ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}
                                            onClick={() => toggleTagSelection(tag.id)}
                                        >
                                            <Checkbox checked={selectedTags.has(tag.id)} />
                                            <Badge style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }} className="border shadow-sm">
                                                {tag.name}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>

                        {/* 2. Select VMs */}
                        <Card className="lg:col-span-2 h-[600px] flex flex-col">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <CardTitle>2. VMs wählen</CardTitle>
                                <div className="text-sm text-muted-foreground">
                                    {selectedVMs.size} ausgewählt
                                </div>
                            </CardHeader>
                            <CardContent className="flex-1 overflow-auto p-4 pt-0">
                                <div className="space-y-6">
                                    {servers.map(server => (
                                        <div key={server.id}>
                                            <h3 className="flex items-center gap-2 font-medium mb-2 sticky top-0 bg-background py-2 z-10">
                                                <ServerIcon className="h-4 w-4" /> {server.name}
                                            </h3>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-4">
                                                {vmsByServer[server.id]?.map(vm => {
                                                    const key = `${server.id}-${vm.vmid}`;
                                                    return (
                                                        <div
                                                            key={key}
                                                            className={`flex items-center gap-3 p-2 rounded border cursor-pointer text-sm ${selectedVMs.has(key) ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}
                                                            onClick={() => toggleVM(key)}
                                                        >
                                                            <Checkbox checked={selectedVMs.has(key)} />
                                                            <div className="min-w-0">
                                                                <div className="font-medium truncate">{vm.name} <span className="text-muted-foreground">({vm.vmid})</span></div>

                                                                <div className="text-xs text-muted-foreground flex gap-1 mt-1">

                                                                    {vm.tags && vm.tags.map(t => {
                                                                        // Find color from tags list or use default
                                                                        const knownTag = tags.find(tag => tag.name === t);
                                                                        const color = knownTag?.color || '#e5e7eb';
                                                                        return (
                                                                            <span
                                                                                key={t}
                                                                                className="px-1 rounded"
                                                                                style={{
                                                                                    backgroundColor: color,
                                                                                    color: getContrastColor(color)
                                                                                }}
                                                                            >
                                                                                {t}
                                                                            </span>
                                                                        )
                                                                    })}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                                {(!vmsByServer[server.id] || vmsByServer[server.id].length === 0) && (
                                                    <p className="text-sm text-muted-foreground italic">Keine VMs gefunden API Error?</p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="flex justify-end pt-4 border-t">
                        <Button size="lg" onClick={handleAssign} disabled={selectedTags.size === 0 || selectedVMs.size === 0 || assigning}>
                            {assigning ? <Loader2 className="animate-spin mr-2" /> : <TagIcon className="mr-2" />}
                            Tags Zuweisen
                        </Button>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}

// AI Component


