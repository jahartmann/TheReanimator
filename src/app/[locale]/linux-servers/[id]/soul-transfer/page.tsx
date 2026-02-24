import { getDb } from '@/lib/db';
import { notFound } from 'next/navigation';
import { SoulTransferWizard } from '@/components/soul-transfer/SoulTransferWizard';

export default async function SoulTransferPage({
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

    return (
        <div className="max-w-4xl mx-auto py-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold mb-2">Soul Transfer</h1>
                <p className="text-muted-foreground">
                    Migrating services from <span className="font-mono text-foreground font-bold">{host.hostname}</span> via Reanimator Protocol.
                </p>
            </div>

            <SoulTransferWizard hostId={hostId} hostName={host.name} />
        </div>
    );
}
