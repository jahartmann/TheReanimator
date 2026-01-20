'use client';

import { useState, useEffect, useMemo } from 'react';
import { Tag, getTags, createTag, deleteTag, syncTagsFromProxmox, pushTagsToServer } from '@/app/actions/tags';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Plus, Trash2, Upload, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';

function getContrastColor(hexColor: string) {
    if (!hexColor) return 'white';
    const hex = hexColor.replace('#', '');
    if (hex.length !== 6) return 'white';
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? 'black' : 'white';
}

export default function TagManagement({ serverId }: { serverId: number }) {
    const [tags, setTags] = useState<Tag[]>([]);
    const [loading, setLoading] = useState(false);
    const [newTagName, setNewTagName] = useState('');
    const [newTagColor, setNewTagColor] = useState('#EF4444');
    const [syncing, setSyncing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        loadTags();
    }, []);

    async function loadTags() {
        setLoading(true);
        try {
            const fetchedTags = await getTags();
            setTags(fetchedTags);
        } catch (e) {
            toast.error('Fehler beim Laden der Tags');
        } finally {
            setLoading(false);
        }
    }

    const filteredTags = useMemo(() => {
        if (!searchQuery.trim()) return tags;
        const q = searchQuery.toLowerCase();
        return tags.filter(t => t.name.toLowerCase().includes(q));
    }, [tags, searchQuery]);

    // Group tags alphabetically
    const groupedTags = useMemo(() => {
        const groups: Record<string, Tag[]> = {};
        filteredTags.forEach(tag => {
            const firstLetter = tag.name[0]?.toUpperCase() || '#';
            if (!groups[firstLetter]) groups[firstLetter] = [];
            groups[firstLetter].push(tag);
        });
        return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
    }, [filteredTags]);

    async function handleCreateTag() {
        if (!newTagName) return;
        try {
            const res = await createTag(newTagName, newTagColor);
            if (res.success && res.tag) {
                setTags([...tags, res.tag]);
                setNewTagName('');
                toast.success('Tag erstellt');
            } else {
                toast.error(res.error || 'Fehler beim Erstellen');
            }
        } catch (e) {
            toast.error('Fehler beim Erstellen');
        }
    }

    async function handleDeleteTag(id: number) {
        if (!confirm('Tag löschen? Dies entfernt nur den lokalen Eintrag.')) return;
        try {
            await deleteTag(id);
            setTags(tags.filter(t => t.id !== id));
            toast.success('Tag gelöscht');
        } catch (e) {
            toast.error('Fehler beim Löschen');
        }
    }

    async function handleSync() {
        setSyncing(true);
        try {
            const res = await syncTagsFromProxmox(serverId);
            if (res.success) {
                toast.success(res.message);
                loadTags();
            } else {
                toast.error(res.message);
            }
        } catch (e) {
            toast.error('Sync fehlgeschlagen');
        } finally {
            setSyncing(false);
        }
    }

    async function handlePush() {
        setSyncing(true);
        try {
            const res = await pushTagsToServer(serverId, tags);
            if (res.success) {
                toast.success('Tags an Server übertragen');
            } else {
                toast.error(res.message);
            }
        } catch (e) {
            toast.error('Push fehlgeschlagen');
        } finally {
            setSyncing(false);
        }
    }

    return (
        <Card className="w-full">
            <CardHeader className="pb-3">
                <CardTitle className="flex justify-between items-center">
                    <span>Tag Management</span>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
                            {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                            Sync
                        </Button>
                        <Button variant="secondary" size="sm" onClick={handlePush} disabled={syncing}>
                            {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                            Push
                        </Button>
                    </div>
                </CardTitle>
                <CardDescription>
                    Tags lokal verwalten und mit Proxmox synchronisieren
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Create New Tag */}
                <div className="flex gap-2 items-end">
                    <div className="flex-1">
                        <Input
                            placeholder="Neuer Tag (z.B. production)"
                            value={newTagName}
                            onChange={(e) => setNewTagName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
                        />
                    </div>
                    <Input
                        type="color"
                        className="w-10 h-10 p-1 cursor-pointer"
                        value={newTagColor}
                        onChange={(e) => setNewTagColor(e.target.value)}
                    />
                    <Button onClick={handleCreateTag} disabled={!newTagName} size="icon">
                        <Plus className="h-4 w-4" />
                    </Button>
                </div>

                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Tags suchen..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                    {searchQuery && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                            onClick={() => setSearchQuery('')}
                        >
                            <X className="h-3 w-3" />
                        </Button>
                    )}
                </div>

                {/* Tags List */}
                <ScrollArea className="h-[300px] border rounded-md p-2">
                    {loading ? (
                        <div className="flex justify-center p-4">
                            <Loader2 className="h-6 w-6 animate-spin" />
                        </div>
                    ) : filteredTags.length === 0 ? (
                        <div className="text-center text-muted-foreground p-4">
                            {searchQuery ? 'Keine passenden Tags gefunden.' : 'Keine Tags vorhanden. Starten Sie einen Scan.'}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {groupedTags.map(([letter, letterTags]) => (
                                <div key={letter}>
                                    <div className="sticky top-0 bg-background/95 px-2 py-1 text-xs font-medium text-muted-foreground border-b mb-2">
                                        {letter}
                                    </div>
                                    <div className="flex flex-wrap gap-2 px-1">
                                        {letterTags.map(tag => {
                                            const bgColor = tag.color.startsWith('#') ? tag.color : `#${tag.color}`;
                                            return (
                                                <Badge
                                                    key={tag.id}
                                                    className="group relative pr-6 cursor-default break-all"
                                                    style={{
                                                        backgroundColor: bgColor,
                                                        color: getContrastColor(tag.color)
                                                    }}
                                                >
                                                    {tag.name}
                                                    <button
                                                        onClick={() => handleDeleteTag(tag.id)}
                                                        className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-black/20 rounded"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </Badge>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>

                {/* Stats */}
                <div className="text-xs text-muted-foreground text-right">
                    {tags.length} Tags insgesamt
                    {searchQuery && ` • ${filteredTags.length} gefiltert`}
                </div>
            </CardContent>
        </Card>
    );
}
