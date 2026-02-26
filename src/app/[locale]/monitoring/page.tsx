export const dynamic = 'force-dynamic';

import { getServers } from '@/lib/actions/server';
import { MonitoringClient } from './MonitoringClient';

export default async function MonitoringPage() {
    const servers = await getServers();
    const pveServers = servers.filter(s => s.type === 'pve');

    return <MonitoringClient servers={pveServers} />;
}
