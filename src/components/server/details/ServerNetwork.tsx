'use client';

import { NetworkEditor } from '@/components/server/network/NetworkEditor';

interface ServerNetworkProps {
    info: any;
    serverId: number;
}

export function ServerNetwork({ info, serverId }: ServerNetworkProps) {
    return (
        <div className="space-y-6">
            <NetworkEditor serverId={serverId} />
        </div>
    );
}
