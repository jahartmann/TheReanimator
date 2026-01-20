import Link from 'next/link';
import db from '@/lib/db';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, LayoutDashboard, Monitor, Network as NetworkIcon, HardDrive, Terminal } from "lucide-react";

import { getServerInfo } from '@/app/actions/monitoring';
import { getVMs } from '@/app/actions/vm';
import { getTags } from '@/app/actions/tags';

import { ServerHeader } from '@/components/server/details/ServerHeader';
import { ServerOverview } from '@/components/server/details/ServerOverview';
import { ServerHardware } from '@/components/server/details/ServerHardware';
import { ServerNetwork } from '@/components/server/details/ServerNetwork';
import { VirtualMachineList } from '@/components/vm/VirtualMachineList';

export const dynamic = 'force-dynamic';

interface ServerItem {
    id: number;
    name: string;
    type: 'pve' | 'pbs';
    url: string;
    ssh_host?: string;
    ssh_port?: number;
    ssh_user?: string;
    ssh_key?: string;
    group_name?: string | null;
}

export default async function ServerDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const serverId = parseInt(id);

    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as ServerItem | undefined;

    if (!server) {
        return (
            <div className="text-center py-20">
                <h1 className="text-2xl font-bold">Server nicht gefunden</h1>
                <Link href="/servers">
                    <Button className="mt-4">Zurück</Button>
                </Link>
            </div>
        );
    }

    const [info, vms, availableTags, scanResults] = await Promise.all([
        getServerInfo(server),
        getVMs(serverId),
        getTags(),
        getScanResults(serverId)
    ]);

    const otherServers = db.prepare('SELECT id, name FROM servers WHERE id != ?').all(serverId) as { id: number; name: string }[];

    return (
        <div className="space-y-6">
            <ServerHeader server={server} />

            {!info ? (
                <Card className="border-amber-500/50 bg-amber-500/10">
                    <CardContent className="p-6">
                        <p className="text-amber-400">
                            SSH-Verbindung fehlgeschlagen. Prüfen Sie die SSH-Zugangsdaten.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <Tabs defaultValue="overview" className="space-y-6">
                    <TabsList className="bg-background border h-auto p-1">
                        <TabsTrigger value="overview" className="gap-2 px-4 py-2">
                            <LayoutDashboard className="h-4 w-4" />
                            Übersicht
                        </TabsTrigger>
                        <TabsTrigger value="vms" className="gap-2 px-4 py-2">
                            <Monitor className="h-4 w-4" />
                            VMs & Container
                            <span className="bg-muted px-1.5 py-0.5 rounded-full text-[10px]">{vms.length}</span>
                        </TabsTrigger>
                        <TabsTrigger value="health" className="gap-2 px-4 py-2">
                            <ShieldCheck className="h-4 w-4" />
                            Health & Security
                        </TabsTrigger>
                        <TabsTrigger value="hardware" className="gap-2 px-4 py-2">
                            <HardDrive className="h-4 w-4" />
                            Hardware
                        </TabsTrigger>
                        <TabsTrigger value="network" className="gap-2 px-4 py-2">
                            <NetworkIcon className="h-4 w-4" />
                            Netzwerk
                        </TabsTrigger>
                        <TabsTrigger value="debug" className="gap-2 px-4 py-2">
                            <Terminal className="h-4 w-4" />
                            Debug
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview">
                        <ServerOverview server={server} info={info} />
                    </TabsContent>

                    <TabsContent value="vms">
                        <VirtualMachineList
                            vms={vms}
                            currentServerId={serverId}
                            otherServers={otherServers}
                            availableTags={availableTags}
                        />
                    </TabsContent>

                    <TabsContent value="health">
                        <ServerHealth initialResults={scanResults} serverId={serverId} />
                    </TabsContent>

                    <TabsContent value="hardware">
                        <ServerHardware info={info} />
                    </TabsContent>

                    <TabsContent value="network">
                        <ServerNetwork info={info} serverId={serverId} />
                    </TabsContent>

                    <TabsContent value="debug">
                        <Card className="overflow-hidden border-muted/60 bg-muted/5">
                            <CardContent className="p-0">
                                <div className="p-4 bg-black/80 font-mono text-xs text-green-500 overflow-x-auto max-h-[500px] whitespace-pre-wrap">
                                    {info.debug?.join('\n') || 'No debug logs available'}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            )}
        </div>
    );
}

import { getScanResults } from '@/app/actions/scan';
import { ServerHealth } from '@/components/server/details/ServerHealth';
import { ShieldCheck } from 'lucide-react';
