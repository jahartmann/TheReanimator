'use client';

import { useState } from 'react';
import { Terminal, FolderOpen } from 'lucide-react';
import TerminalClient from './TerminalClient';
import FileManagerClient from './FileManagerClient';
import { useTranslations } from 'next-intl';

interface ConsoleTabsProps {
    wsUrl: string;
    serverName: string;
    vmid: string;
    serverId: number;
}

export default function ConsoleTabsClient({ wsUrl, serverName, vmid, serverId }: ConsoleTabsProps) {
    const [activeTab, setActiveTab] = useState<'terminal' | 'files'>('terminal');
    const t = useTranslations('console');

    return (
        <div className="flex flex-col h-full">
            {/* Tab Header */}
            <div className="flex items-center gap-1 border-b mb-2">
                <button
                    onClick={() => setActiveTab('terminal')}
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'terminal'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    <Terminal className="h-4 w-4" />
                    {t('terminal')}
                </button>
                <button
                    onClick={() => setActiveTab('files')}
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'files'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                    <FolderOpen className="h-4 w-4" />
                    {t('files')}
                </button>
            </div>

            {/* Tab Content */}
            <div className="flex-1 min-h-0">
                <div className={activeTab === 'terminal' ? 'h-full' : 'hidden'}>
                    <TerminalClient wsUrl={wsUrl} serverName={serverName} vmid={vmid} />
                </div>
                {activeTab === 'files' && (
                    <div className="h-full border rounded-lg overflow-hidden">
                        <FileManagerClient serverId={serverId} vmid={vmid} />
                    </div>
                )}
            </div>
        </div>
    );
}
