'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Brain, Heart, User, Wrench, Ghost, Save, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const ORGANS = [
    { id: 'soul', name: 'SOUL', icon: Ghost, description: 'Persona & Core Directives' },
    { id: 'heart', name: 'HEART', icon: Heart, description: 'Rhythmic Tasks & Health Checks' },
    { id: 'brain', name: 'MEMORY', icon: Brain, description: 'Long-term Knowledge' },
    { id: 'user', name: 'USER', icon: User, description: 'User Profile & Preferences' },
    { id: 'tools', name: 'TOOLS', icon: Wrench, description: 'Tool Documentation' },
];

export function OrganViewer() {
    const [activeOrgan, setActiveOrgan] = useState('soul');
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchContent(activeOrgan);
    }, [activeOrgan]);

    const fetchContent = async (organId: string) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/organs/content?organ=${organId}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();
            setContent(data.content || '');
        } catch (error) {
            toast.error('Failed to load organ data');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/organs/content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organ: activeOrgan, content }),
            });

            if (!res.ok) throw new Error('Failed to save');
            toast.success(`${activeOrgan.toUpperCase()} updated successfully`);
        } catch (error) {
            toast.error('Failed to save changes');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Anatomy of the Agent</h2>
                    <p className="text-muted-foreground">View and modify the internal organs of the Reanimator.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => fetchContent(activeOrgan)} disabled={loading || saving}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            <Card className="flex flex-col overflow-hidden border-sidebar-border/50 shadow-sm bg-background/50 h-[calc(100vh-18rem)]">
                <div className="flex flex-1 min-h-0">
                    {/* Sidebar Tabs */}
                    <div className="w-64 border-r border-sidebar-border bg-muted/20 p-2 space-y-1">
                        {ORGANS.map((organ) => {
                            const Icon = organ.icon;
                            return (
                                <button
                                    key={organ.id}
                                    onClick={() => setActiveOrgan(organ.id)}
                                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-md text-sm transition-all ${activeOrgan === organ.id
                                            ? 'bg-primary/10 text-primary font-medium shadow-sm border border-primary/20'
                                            : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                                        }`}
                                >
                                    <Icon className="h-4 w-4" />
                                    <div className="flex flex-col items-start gap-0.5">
                                        <span>{organ.name}</span>
                                        <span className="text-[10px] opacity-70 font-normal text-left leading-tight">{organ.description}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {/* Content Editor */}
                    <div className="flex-1 flex flex-col h-full bg-background relative">
                        <div className="p-3 border-b flex items-center justify-between bg-muted/10 shrink-0">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm font-mono text-primary">{activeOrgan.toUpperCase()}.md</span>
                            </div>
                            <Button onClick={handleSave} disabled={saving || loading} size="sm">
                                <Save className="h-4 w-4 mr-2" />
                                {saving ? 'Saving...' : 'Save Changes'}
                            </Button>
                        </div>

                        <div className="flex-1 relative overflow-hidden">
                            {loading && (
                                <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10 backdrop-blur-[1px]">
                                    <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                                </div>
                            )}
                            <Textarea
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                                className="w-full h-full resize-none p-6 font-mono text-sm border-0 focus-visible:ring-0 rounded-none bg-transparent leading-relaxed"
                                placeholder="Empty organ..."
                                spellCheck={false}
                            />
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
}
