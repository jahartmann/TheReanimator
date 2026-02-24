'use client';

import { useState, useMemo, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Disc, FileCode, RefreshCw, Search, HardDrive, Server } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import Link from 'next/link';
import { SyncDialog } from '@/components/library/SyncDialog';
import { LibraryLoadingSkeleton } from '@/components/library/LibraryLoadingSkeleton';
import { LibraryItem } from '@/lib/actions/library';

interface LibraryViewProps {
    initialItems: LibraryItem[];
    servers: { id: number, name: string }[];
}

function formatBytes(bytes: number) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function LibraryView({ initialItems, servers }: LibraryViewProps) {
    const t = useTranslations('library');
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState('all');

    const filteredItems = useMemo(() => {
        return initialItems.filter(item => {
            // Filter by Tab
            if (activeTab === 'iso' && item.type !== 'iso') return false;
            if (activeTab === 'vztmpl' && item.type !== 'vztmpl') return false;

            // Filter by Search
            if (searchTerm && !item.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;

            return true;
        });
    }, [initialItems, searchTerm, activeTab]);

    // Simulate loading for demo - remove this in production
    useEffect(() => {
        const timer = setTimeout(() => setLoading(false), 500);
        return () => clearTimeout(timer);
    }, []);

    if (loading) {
        return <LibraryLoadingSkeleton />;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
                    <p className="text-muted-foreground">
                        {t('subtitle')} ({initialItems.length} {t('items')})
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" asChild>
                        <Link href="/library">
                            <RefreshCw className="h-4 w-4 mr-2" />
                            {t('refresh')}
                        </Link>
                    </Button>
                </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-card p-4 rounded-lg border shadow-sm">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full md:w-auto">
                    <TabsList>
                        <TabsTrigger value="all">{t('all')}</TabsTrigger>
                        <TabsTrigger value="iso" className="flex gap-2"><Disc className="w-4 h-4" /> {t('iso')}</TabsTrigger>
                        <TabsTrigger value="vztmpl" className="flex gap-2"><FileCode className="w-4 h-4" /> {t('templates')}</TabsTrigger>
                    </TabsList>
                </Tabs>
                <div className="relative w-full md:w-72">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={t('searchPlaceholder')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-8"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredItems.map((item) => (
                    <Card key={item.name} className="flex flex-col hover:shadow-md transition-shadow">
                        <CardHeader className="pb-3">
                            <div className="flex justify-between items-start">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${item.type === 'iso' ? 'bg-purple-500/10 text-purple-500' : 'bg-blue-500/10 text-blue-500 '}`}>
                                        {item.type === 'iso' ? <Disc className="h-6 w-6" /> : <FileCode className="h-6 w-6" />}
                                    </div>
                                    <div>
                                        <CardTitle className="text-base font-semibold leading-none break-all">
                                            {item.name}
                                        </CardTitle>
                                        <span className="text-xs text-muted-foreground mt-1 block uppercase font-mono">
                                            {item.format} • {formatBytes(item.size)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="flex-1 pb-3">
                            <div className="text-sm font-medium mb-2 text-muted-foreground flex items-center gap-2">
                                <HardDrive className="h-4 w-4" /> {t('availableOn')}:
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {item.locations.map((loc, i) => (
                                    <Badge key={i} variant="secondary" className="font-normal bg-muted border">
                                        <Server className="h-3 w-3 mr-1 opacity-50" />
                                        <span className="font-semibold mr-1">{loc.serverName}</span>
                                        <span className="text-muted-foreground">({loc.storage})</span>
                                    </Badge>
                                ))}
                            </div>
                        </CardContent>
                        <CardFooter className="pt-3 border-t bg-muted/5">
                            <div className="w-full flex justify-end">
                                <SyncDialog item={item} servers={servers} />
                            </div>
                        </CardFooter>
                    </Card>
                ))}

                {filteredItems.length === 0 && (
                    <div className="col-span-full py-12 text-center text-muted-foreground bg-muted/10 rounded-lg border border-dashed">
                        {t('itemsNotFound')}
                    </div>
                )}
            </div>
        </div>
    );
}
