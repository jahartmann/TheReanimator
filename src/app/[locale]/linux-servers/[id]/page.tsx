import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Terminal, Trash2, Ghost } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getDb } from '@/lib/db';
import { removeLinuxHost } from '@/lib/actions/linux';

export const dynamic = 'force-dynamic';

export default async function LinuxServerDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const hostId = parseInt(id);

    const db = getDb();
    const host = db.prepare('SELECT * FROM linux_hosts WHERE id = ?').get(hostId) as any;

    if (!host) {
        notFound();
    }

    async function deleteServer() {
        'use server';
        await removeLinuxHost(hostId);
        redirect('/dashboard');
    }

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex items-center gap-4">
                <Link href="/dashboard">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <h1 className="text-2xl font-bold">{host.name}</h1>
                        <span className="bg-zinc-500/10 text-zinc-500 text-xs px-2 py-1 rounded font-mono">
                            Generic Linux
                        </span>
                    </div>
                    <p className="text-muted-foreground">{host.hostname} : {host.port}</p>
                </div>
                <form action={deleteServer}>
                    <Button variant="destructive" size="sm">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                    </Button>
                </form>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Soul Transfer</CardTitle>
                        <CardDescription>
                            Mistrate services from this server to a Proxmox Container.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground mb-4">
                            The Reanimator can extract Docker containers from this host and reanimate them as LXC vessels on your Proxmox cluster.
                        </p>
                        <Link href={`/linux-servers/${hostId}/soul-transfer`}>
                            <Button className="w-full bg-purple-600 hover:bg-purple-700">
                                <Ghost className="mr-2 h-4 w-4" />
                                Begin Ritual
                            </Button>
                        </Link>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>SSH Config</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">User:</span>
                            <span className="font-mono">{host.username}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Key Path:</span>
                            <span className="font-mono">{host.ssh_key_path || 'Default (~/.ssh/id_rsa)'}</span>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
