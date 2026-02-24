'use client';

import Link from 'next/link';
import { ArrowLeft, Server, Tags, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import TagManagement from '@/components/ui/TagManagement';
import { ServerSyncButton } from '@/components/server/ServerSyncButton';
import EditServerDialog from '@/components/server/EditServerDialog';
import { useTranslations } from 'next-intl';


interface ServerHeaderProps {
    server: {
        id: number;
        name: string;
        type: 'pve' | 'pbs';
        url: string;
        group_name?: string | null;
        ssh_host?: string;
    };
}

export function ServerHeader({ server }: ServerHeaderProps) {
    const t = useTranslations('servers');

    return (
        <div className="flex items-center gap-4">
            <Link href="/servers">
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-4 w-4" />
                </Button>
            </Link>
            <div className="flex items-center gap-3 flex-1">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${server.type === 'pve' ? 'bg-orange-500/20' : 'bg-blue-500/20'}`}>
                    <Server className={`h-6 w-6 ${server.type === 'pve' ? 'text-orange-500' : 'text-blue-500'}`} />
                </div>
                <div>
                    <div className="flex items-center gap-2">
                        <h1 className="text-2xl font-bold">{server.name}</h1>
                        {server.group_name && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                {server.group_name}
                            </span>
                        )}
                    </div>
                    <p className="text-muted-foreground">
                        {server.type.toUpperCase()} · {server.ssh_host || new URL(server.url).hostname}
                    </p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <div className="flex items-center gap-2">
                        <Link href={`?edit=true`}>
                            <Button variant="outline" size="sm">
                                <Settings className="mr-2 h-4 w-4" />
                                {t('settings')}
                            </Button>
                        </Link>
                    </div>
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button variant="outline" size="sm">
                                <Tags className="h-4 w-4 mr-2" />
                                {t('tags')}
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                            <TagManagement serverId={server.id} />
                        </DialogContent>
                    </Dialog>
                    <ServerSyncButton serverId={server.id} />
                    <EditServerDialog server={{
                        ...server,
                        group_name: server.group_name || undefined,
                    }} />
                </div>
            </div>
        </div>
    );
}
