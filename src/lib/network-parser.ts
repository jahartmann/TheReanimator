
export interface NetworkInterface {
    name: string;
    method: 'static' | 'manual' | 'dhcp' | 'loopback';
    family: 'inet' | 'inet6';
    auto: boolean;
    address?: string;
    netmask?: string;
    gateway?: string;
    // Bridge options
    bridge_ports?: string;
    bridge_stp?: 'on' | 'off';
    bridge_fd?: number;
    bridge_vlan_aware?: 'yes' | 'no';
    // Bond options
    bond_slaves?: string;
    bond_miimon?: number;
    bond_mode?: string;
    bond_xmit_hash_policy?: string;
    // Comments/Raw
    comments: string[];
    rawLines: string[]; // Keep unknown lines to preserve them
}

export function parseNetworkInterfaces(content: string): NetworkInterface[] {
    const lines = content.split('\n');
    const interfaces: NetworkInterface[] = [];
    let current: NetworkInterface | null = null;
    let autoInterfaces = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const parts = line.split(/\s+/);

        // Skip empty lines if no current content
        if (!line && !current) continue;

        // Auto declaration
        if (line.startsWith('auto') || parts[0] === 'auto') {
            for (let j = 1; j < parts.length; j++) {
                autoInterfaces.add(parts[j]);
            }
            continue;
        }

        // Iface declaration
        if (parts[0] === 'iface') {
            // Save previous
            if (current) {
                interfaces.push(current);
            }

            const parts = line.split(/\s+/);
            const name = parts[1];
            const family = parts[2] === 'inet6' ? 'inet6' : 'inet';
            const method = parts[3] as any || 'manual';

            current = {
                name,
                family,
                method,
                auto: autoInterfaces.has(name),
                comments: [],
                rawLines: []
            };
            continue;
        }

        // Properties (indented or just after iface)
        if (current) {
            if (line.startsWith('#')) {
                current.comments.push(line);
                continue;
            }
            if (!line) continue; // Skip empty lines inside block for now

            const parts = line.split(/\s+/);
            const key = parts[0];
            const value = parts.slice(1).join(' ');

            switch (key) {
                case 'address': current.address = value; break;
                case 'netmask': current.netmask = value; break;
                case 'gateway': current.gateway = value; break;
                case 'bridge-ports': current.bridge_ports = value; break;
                case 'bridge-stp': current.bridge_stp = value as any; break;
                case 'bridge-fd': current.bridge_fd = parseInt(value); break;
                case 'bridge-vlan-aware': current.bridge_vlan_aware = value as any; break;
                case 'bond-slaves': current.bond_slaves = value; break;
                case 'bond-miimon': current.bond_miimon = parseInt(value); break;
                case 'bond-mode': current.bond_mode = value; break;
                case 'bond-xmit_hash_policy': current.bond_xmit_hash_policy = value; break;
                default: current.rawLines.push(line); break;
            }
        }
    }

    if (current) {
        interfaces.push(current);
    }

    // retro-actively check auto flag if it was defined after? (Unlikely in valid configs)
    // But update just in case for interfaces defined before 'auto' line?
    // Actually debian layout usually has auto before or scattered.
    // The current logic handles auto appearing *before* or separate correctly? 
    // Wait, if 'auto eth0' is at top, and 'iface eth0' is below, my logic works.
    // If 'iface eth0' is top, and 'auto eth0' is bottom, my logic fails for that iface.
    // Let's fix that.

    interfaces.forEach(iface => {
        if (autoInterfaces.has(iface.name)) {
            iface.auto = true;
        }
    });

    return interfaces;
}

export function generateNetworkInterfaces(interfaces: NetworkInterface[]): string {
    let output = '# This file describes the network interfaces available on your system\n';
    output += '# and how to activate them. For more information, see interfaces(5).\n\n';
    output += 'source /etc/network/interfaces.d/*\n\n';

    // Loopback first convention
    const lo = interfaces.find(i => i.method === 'loopback');
    const others = interfaces.filter(i => i.method !== 'loopback');

    const all = lo ? [lo, ...others] : others;

    all.forEach(iface => {
        if (iface.auto) {
            output += `auto ${iface.name}\n`;
        }

        output += `iface ${iface.name} ${iface.family} ${iface.method}\n`;

        if (iface.address) output += `\taddress ${iface.address}\n`;
        if (iface.netmask) output += `\tnetmask ${iface.netmask}\n`;
        if (iface.gateway) output += `\tgateway ${iface.gateway}\n`;

        if (iface.bridge_ports) output += `\tbridge-ports ${iface.bridge_ports}\n`;
        if (iface.bridge_stp) output += `\tbridge-stp ${iface.bridge_stp}\n`;
        if (iface.bridge_fd !== undefined) output += `\tbridge-fd ${iface.bridge_fd}\n`;
        if (iface.bridge_vlan_aware) output += `\tbridge-vlan-aware ${iface.bridge_vlan_aware}\n`;

        if (iface.bond_slaves) output += `\tbond-slaves ${iface.bond_slaves}\n`;
        if (iface.bond_miimon) output += `\tbond-miimon ${iface.bond_miimon}\n`;
        if (iface.bond_mode) output += `\tbond-mode ${iface.bond_mode}\n`;
        if (iface.bond_xmit_hash_policy) output += `\tbond-xmit_hash_policy ${iface.bond_xmit_hash_policy}\n`;

        // Raw lines
        iface.rawLines.forEach(line => output += `\t${line}\n`);

        // Comments
        iface.comments.forEach(c => output += `${c}\n`); // Comments usually have # already

        output += '\n';
    });

    return output;
}
