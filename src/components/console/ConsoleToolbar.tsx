'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Monitor, Terminal, FolderOpen, Download, Maximize, RotateCcw, Keyboard } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

interface ConsoleToolbarProps {
    vmName: string;
    vmid: number;
    vmType: 'qemu' | 'lxc';
    status: string;
    serverName: string;
    activeTab: string;
    onTabChange: (tab: string) => void;
    onFullscreen?: () => void;
    onCtrlAltDel?: () => void;
    onReconnect?: () => void;
    onSpiceDownload?: () => void;
    connected: boolean;
}

export function ConsoleToolbar({
    vmName, vmid, vmType, status, serverName,
    activeTab, onTabChange,
    onFullscreen, onCtrlAltDel, onReconnect, onSpiceDownload,
    connected
}: ConsoleToolbarProps) {
    const router = useRouter();
    const t = useTranslations('console');

    return (
        <div className="flex items-center justify-between border-b bg-background/95 backdrop-blur px-4 py-2">
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{vmName}</span>
                    <Badge variant="outline" className="text-xs">{vmid}</Badge>
                    <Badge variant={status === 'running' ? 'default' : 'secondary'} className="text-xs">
                        {status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{serverName}</span>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={onTabChange}>
                <TabsList>
                    {vmType === 'qemu' && (
                        <TabsTrigger value="vnc" className="gap-1.5">
                            <Monitor className="h-3.5 w-3.5" />
                            VNC
                        </TabsTrigger>
                    )}
                    <TabsTrigger value="terminal" className="gap-1.5">
                        <Terminal className="h-3.5 w-3.5" />
                        {t('terminal')}
                    </TabsTrigger>
                    <TabsTrigger value="files" className="gap-1.5">
                        <FolderOpen className="h-3.5 w-3.5" />
                        {t('files')}
                    </TabsTrigger>
                </TabsList>
            </Tabs>

            <div className="flex items-center gap-1">
                {activeTab === 'vnc' && (
                    <>
                        <Button variant="ghost" size="icon" onClick={onCtrlAltDel} title="Ctrl+Alt+Del">
                            <Keyboard className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={onFullscreen} title={t('fullscreen')}>
                            <Maximize className="h-4 w-4" />
                        </Button>
                    </>
                )}
                {(activeTab === 'vnc' || activeTab === 'terminal') && (
                    <Button variant="ghost" size="icon" onClick={onReconnect} title={t('reconnect')}>
                        <RotateCcw className="h-4 w-4" />
                    </Button>
                )}
                {vmType === 'qemu' && (
                    <Button variant="ghost" size="sm" onClick={onSpiceDownload} className="gap-1.5">
                        <Download className="h-3.5 w-3.5" />
                        SPICE
                    </Button>
                )}
                <Badge variant={connected ? 'default' : 'destructive'} className="ml-2 text-xs">
                    {connected ? t('connected') : t('disconnected')}
                </Badge>
            </div>
        </div>
    );
}
