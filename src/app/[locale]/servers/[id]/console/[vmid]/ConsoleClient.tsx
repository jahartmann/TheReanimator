'use client';

import { useState, useRef, useCallback } from 'react';
import { ConsoleToolbar } from '@/components/console/ConsoleToolbar';
import { VncConsole } from '@/components/console/VncConsole';
import { TerminalConsole } from '@/components/console/TerminalConsole';
import { FileExplorer } from '@/components/console/FileExplorer';
import { getSpiceFile } from '@/lib/actions/console';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';

interface ConsoleClientProps {
    serverId: number;
    vmid: number;
    vmInfo: {
        name: string;
        status: string;
        type: 'qemu' | 'lxc';
        node: string;
        serverId: number;
        serverName: string;
    };
}

export function ConsoleClient({ serverId, vmid, vmInfo }: ConsoleClientProps) {
    const [activeTab, setActiveTab] = useState<string>(vmInfo.type === 'qemu' ? 'vnc' : 'terminal');
    const [connected, setConnected] = useState(false);
    const [showFilePanel, setShowFilePanel] = useState(false);
    const ctrlAltDelRef = useRef<(() => void) | null>(null);
    const consoleContainerRef = useRef<HTMLDivElement>(null);

    const handleConnect = useCallback(() => setConnected(true), []);
    const handleDisconnect = useCallback(() => setConnected(false), []);

    const handleFullscreen = useCallback(() => {
        if (consoleContainerRef.current) {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                consoleContainerRef.current.requestFullscreen();
            }
        }
    }, []);

    const handleCtrlAltDel = useCallback(() => {
        ctrlAltDelRef.current?.();
    }, []);

    const handleReconnect = useCallback(() => {
        setConnected(false);
        setActiveTab(prev => {
            setTimeout(() => setActiveTab(prev), 50);
            return '';
        });
    }, []);

    const handleSpiceDownload = useCallback(async () => {
        try {
            const vvContent = await getSpiceFile(serverId, vmid);
            const blob = new Blob([vvContent], { type: 'application/x-virt-viewer' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `vm-${vmid}.vv`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success('SPICE file downloaded');
        } catch {
            toast.error('Failed to generate SPICE file');
        }
    }, [serverId, vmid]);

    const handleTabChange = useCallback((tab: string) => {
        // When switching to files tab, close the side panel
        if (tab === 'files') {
            setShowFilePanel(false);
        }
        setActiveTab(tab);
    }, []);

    // Show file panel toggle only when in VNC or Terminal tab
    const canShowFilePanel = activeTab === 'vnc' || activeTab === 'terminal';

    return (
        <div className="flex flex-col h-screen">
            <div className="flex items-center">
                <div className="flex-1">
                    <ConsoleToolbar
                        vmName={vmInfo.name}
                        vmid={vmid}
                        vmType={vmInfo.type}
                        status={vmInfo.status}
                        serverName={vmInfo.serverName}
                        activeTab={activeTab}
                        onTabChange={handleTabChange}
                        onFullscreen={handleFullscreen}
                        onCtrlAltDel={handleCtrlAltDel}
                        onReconnect={handleReconnect}
                        onSpiceDownload={handleSpiceDownload}
                        connected={connected}
                    />
                </div>
                {canShowFilePanel && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="mr-2"
                        onClick={() => setShowFilePanel(!showFilePanel)}
                        title={showFilePanel ? 'Hide file panel' : 'Show file panel'}
                    >
                        {showFilePanel ? (
                            <PanelRightClose className="h-4 w-4" />
                        ) : (
                            <PanelRightOpen className="h-4 w-4" />
                        )}
                    </Button>
                )}
            </div>

            <div ref={consoleContainerRef} className="flex-1 flex overflow-hidden">
                {/* Main console area */}
                <div className="flex-1 overflow-hidden">
                    {activeTab === 'vnc' && vmInfo.type === 'qemu' && (
                        <VncConsole
                            serverId={serverId}
                            vmid={vmid}
                            vmType={vmInfo.type}
                            nodeName={vmInfo.node}
                            onConnect={handleConnect}
                            onDisconnect={handleDisconnect}
                            onCtrlAltDelRef={ctrlAltDelRef}
                        />
                    )}
                    {activeTab === 'terminal' && (
                        <TerminalConsole
                            serverId={serverId}
                            vmid={vmid}
                            vmType={vmInfo.type}
                            onConnect={handleConnect}
                            onDisconnect={handleDisconnect}
                        />
                    )}
                    {activeTab === 'files' && !showFilePanel && (
                        <FileExplorer
                            serverId={serverId}
                            vmid={vmid}
                            vmType={vmInfo.type}
                        />
                    )}
                </div>

                {/* Side file panel (shown alongside VNC/Terminal) */}
                {showFilePanel && canShowFilePanel && (
                    <div className="w-80 border-l flex flex-col overflow-hidden">
                        <FileExplorer
                            serverId={serverId}
                            vmid={vmid}
                            vmType={vmInfo.type}
                            compact
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
