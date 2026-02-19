
'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { BrainCircuit, Activity, Search, FileText, Clock } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface BrainEntry {
    id: number;
    key: string;
    domain: string;
    title: string;
    summary: string | null;
    content: string;
    importance: number;
    tags: string[];
    updated_at: string;
}

interface AutonomousLog {
    id: number;
    run_id: string;
    event_type: string;
    summary: string;
    details?: string;
    status: 'success' | 'failure' | 'neutral';
    created_at: string;
}

interface BrainVisualizerProps {
    entries: BrainEntry[];
    logs: AutonomousLog[];
}

export function BrainVisualizer({ entries, logs }: BrainVisualizerProps) {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredEntries = entries.filter(e =>
        e.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.tags.some(t => t.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
        <div className="h-[600px] flex flex-col">
            <Tabs defaultValue="stream" className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/20 shrink-0">
                    <TabsList>
                        <TabsTrigger value="stream" className="gap-2">
                            <Activity className="h-4 w-4" />
                            Stream of Consciousness
                        </TabsTrigger>
                        <TabsTrigger value="knowledge" className="gap-2">
                            <BrainCircuit className="h-4 w-4" />
                            Knowledge Base
                        </TabsTrigger>
                    </TabsList>
                    <div className="text-xs text-muted-foreground flex gap-4">
                        <span>{logs.length} Thoughts</span>
                        <span>{entries.length} Memories</span>
                    </div>
                </div>

                <TabsContent value="stream" className="flex-1 p-0 m-0 relative min-h-0 overflow-hidden">
                    <ScrollArea className="h-full">
                        <div className="p-4 space-y-4">
                            {logs.map((log) => (
                                <div key={log.id} className="flex gap-4 group">
                                    <div className="flex flex-col items-center">
                                        <div className={`w-2 h-2 rounded-full mt-2 ${log.status === 'success' ? 'bg-green-500' :
                                            log.status === 'failure' ? 'bg-red-500' : 'bg-blue-500'
                                            }`} />
                                        <div className="w-0.5 h-full bg-border group-last:hidden" />
                                    </div>
                                    <div className="flex-1 pb-4 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                                                {new Date(log.created_at).toLocaleTimeString()}
                                            </span>
                                            <Badge variant="outline" className="text-[10px] h-5 px-1 uppercase shrink-0">
                                                {log.event_type}
                                            </Badge>
                                        </div>
                                        <p className="font-medium text-sm text-foreground/90 break-words">{log.summary}</p>
                                        {log.details && (
                                            <div className="mt-2 text-xs bg-muted/50 p-2 rounded-md font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">
                                                {log.details}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {logs.length === 0 && (
                                <div className="text-center text-muted-foreground py-10">
                                    Agent is silent. No thoughts recorded yet.
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </TabsContent>

                <TabsContent value="knowledge" className="flex-1 p-0 m-0 flex flex-col min-h-0">
                    <div className="p-4 border-b shrink-0">
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search memories..."
                                className="pl-8"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                    <ScrollArea className="flex-1">
                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            {filteredEntries.map((entry) => (
                                <Card key={entry.id} className="overflow-hidden hover:border-primary/50 transition-colors flex flex-col h-[300px]">
                                    <CardHeader className="p-4 pb-2 shrink-0">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-2">
                                                <Badge variant="secondary" className="text-[10px]">
                                                    {entry.domain}
                                                </Badge>
                                                {entry.importance >= 8 && (
                                                    <Badge variant="destructive" className="text-[10px]">Important</Badge>
                                                )}
                                            </div>
                                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                                <div className="w-1 h-1 rounded-full bg-green-500" />
                                                v{entry.importance}
                                            </span>
                                        </div>
                                        <CardTitle className="text-sm mt-2 line-clamp-1" title={entry.title}>{entry.title}</CardTitle>
                                    </CardHeader>
                                    <CardContent className="p-4 pt-2 flex-1 min-h-0 flex flex-col">
                                        <ScrollArea className="flex-1 bg-muted/30 rounded p-2 text-xs">
                                            <div className="prose prose-xs dark:prose-invert max-w-none break-words">
                                                <ReactMarkdown>{entry.content}</ReactMarkdown>
                                            </div>
                                        </ScrollArea>
                                        <div className="mt-3 flex flex-wrap gap-1 shrink-0">
                                            {entry.tags.slice(0, 3).map(tag => (
                                                <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-background border rounded text-muted-foreground">
                                                    #{tag}
                                                </span>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                            {filteredEntries.length === 0 && (
                                <div className="col-span-full text-center py-10 text-muted-foreground">
                                    No memories found.
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </TabsContent>
            </Tabs>
        </div>
    );
}
