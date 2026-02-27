/**
 * Proxmox API Client
 * Handles communication with Proxmox VE and Backup Server
 * Uses undici for proper SSL bypass with self-signed certificates
 */

import { Agent, fetch as undiciFetch } from 'undici';

// Create an agent that ignores SSL certificate errors
// Required for Proxmox servers with self-signed certificates
const insecureAgent = new Agent({
    connect: {
        rejectUnauthorized: false
    }
});

interface ProxmoxConfig {
    url: string;
    token?: string; // user@pam!token_id=secret
    username?: string;
    password?: string;
    type: 'pve' | 'pbs';
}

export class ProxmoxClient {
    private config: ProxmoxConfig;
    private ticket: string | null = null;
    private csrfToken: string | null = null;

    constructor(config: ProxmoxConfig) {
        this.config = config;
    }

    // Custom fetch that uses undici with SSL bypass
    private async secureFetch(url: string, options: RequestInit = {}): Promise<Response> {
        console.log(`[Proxmox] Fetching: ${url}`);
        try {
            const response = await undiciFetch(url, {
                ...options,
                dispatcher: insecureAgent
            } as any);
            return response as unknown as Response;
        } catch (error) {
            console.error('[Proxmox] Fetch error:', error);
            throw error;
        }
    }

    // Returns valid headers for requests
    private async getHeaders(): Promise<Record<string, string>> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (this.config.token) {
            // PVE requires "PVEAPIToken=...", PBS requires "PBSAPIToken=..."
            const prefix = this.config.type === 'pve' ? 'PVEAPIToken' : 'PBSAPIToken';
            headers['Authorization'] = `${prefix}=${this.config.token}`;
        } else {
            if (!this.ticket) await this.authenticate();
            if (this.ticket) {
                // PVEAuthCookie vs PBSAuthCookie
                const cookieName = this.config.type === 'pve' ? 'PVEAuthCookie' : 'PBSAuthCookie';
                headers['Cookie'] = `${cookieName}=${this.ticket}`;
                if (this.csrfToken) headers['CSRFPreventionToken'] = this.csrfToken;
            }
        }
        return headers;
    }

    // Authenticate with username/password to get a session ticket
    async authenticate(): Promise<void> {
        if (!this.config.username || !this.config.password) {
            throw new Error('Username and password required for authentication');
        }

        console.log('[Proxmox] Authenticating with password...');
        const authUrl = `${this.config.url}/api2/json/access/ticket`;

        try {
            const body = new URLSearchParams({
                username: this.config.username,
                password: this.config.password
            }).toString();

            const res = await this.secureFetch(authUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body
            });

            if (!res.ok) {
                const errText = await res.text();
                console.error('[Proxmox] Auth failed:', res.status, errText);
                throw new Error(`Authentication failed: ${res.status} - ${errText}`);
            }

            const data = await res.json() as { data: { ticket: string; CSRFPreventionToken: string } };
            this.ticket = data.data.ticket;
            this.csrfToken = data.data.CSRFPreventionToken;
            console.log('[Proxmox] Authentication successful!');
        } catch (e) {
            console.error('[Proxmox] Auth Error:', e);
            throw new Error(`Failed to authenticate: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    // Check if the server is reachable
    async checkStatus(): Promise<boolean> {
        try {
            const headers = await this.getHeaders();
            const res = await this.secureFetch(`${this.config.url}/api2/json/version`, {
                method: 'GET',
                headers
            });
            return res.ok;
        } catch (e) {
            console.error('[Proxmox] Connection failed:', e);
            return false;
        }
    }

    // Generate a new API token for the current user
    async generateToken(tokenId: string = 'proxhost-backup'): Promise<string> {
        // Ensure we are authenticated first (Ticket mode)
        if (!this.ticket) {
            await this.authenticate();
        }

        // Determine user ID
        const userId = this.config.username;
        if (!userId) throw new Error("No username provided");

        const headers = await this.getHeaders();
        console.log('[Proxmox] Generating API token for user:', userId);

        try {
            // Try to delete existing token first (ignore errors)
            try {
                const deleteUrl = `${this.config.url}/api2/json/access/users/${encodeURIComponent(userId)}/token/${tokenId}`;
                await this.secureFetch(deleteUrl, {
                    method: 'DELETE',
                    headers
                });
                console.log('[Proxmox] Deleted existing token');
            } catch (e) {
                // Ignore - token might not exist
            }

            // Create new token
            const createUrl = `${this.config.url}/api2/json/access/users/${encodeURIComponent(userId)}/token/${tokenId}`;
            const res = await this.secureFetch(createUrl, {
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    privsep: '0' // No privilege separation - token inherits user permissions
                }).toString()
            });

            if (!res.ok) {
                const err = await res.text();
                console.error('[Proxmox] Token creation failed:', res.status, err);
                throw new Error(`Failed to create token: ${res.status} - ${err}`);
            }

            const data = await res.json() as { data: { value: string } };
            // Full token format: user@pam!tokenid=secret
            const fullToken = `${userId}!${tokenId}=${data.data.value}`;
            console.log('[Proxmox] Token generated successfully!');
            return fullToken;

        } catch (e) {
            console.error('[Proxmox] Token Generation Failed:', e);
            throw new Error(`Token generation failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    // Get storage information from PVE
    async getStorages(node: string = ''): Promise<StorageInfo[]> {
        const headers = await this.getHeaders();

        if (this.config.type === 'pve') {
            // For PVE, get nodes first if no node specified
            if (!node) {
                const nodesRes = await this.secureFetch(`${this.config.url}/api2/json/nodes`, { headers });
                if (!nodesRes.ok) throw new Error('Failed to get nodes');
                const nodesData = await nodesRes.json() as { data: { node: string }[] };
                node = nodesData.data[0]?.node || 'pve';
            }

            const res = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/storage`, { headers });
            if (!res.ok) throw new Error('Failed to get storage');
            const data = await res.json() as { data: PVEStorage[] };

            return data.data.map(s => ({
                id: s.storage,
                name: s.storage,
                type: s.type,
                total: s.total || 0,
                used: s.used || 0,
                available: s.avail || 0,
                usagePercent: s.total ? Math.round(((s.used ?? 0) / s.total) * 100) : 0,
                content: s.content?.split(',') || [],
                active: s.active === 1
            }));
        } else {
            // PBS - get datastores
            const res = await this.secureFetch(`${this.config.url}/api2/json/admin/datastore`, { headers });
            if (!res.ok) throw new Error('Failed to get datastores');
            const data = await res.json() as { data: PBSDatastore[] };

            return data.data.map(d => ({
                id: d.name,
                name: d.name,
                type: 'pbs-datastore',
                total: 0,
                used: 0,
                available: 0,
                usagePercent: 0,
                content: ['backup'],
                active: true
            }));
        }
    }

    // Get backups from PBS
    async getBackups(datastore: string): Promise<BackupInfo[]> {
        if (this.config.type !== 'pbs') {
            throw new Error('getBackups is only available for PBS servers');
        }

        const headers = await this.getHeaders();
        const res = await this.secureFetch(
            `${this.config.url}/api2/json/admin/datastore/${datastore}/snapshots`,
            { headers }
        );

        if (!res.ok) throw new Error('Failed to get backups');
        const data = await res.json() as { data: PBSSnapshot[] };

        return data.data.map(b => ({
            id: `${b['backup-type']}/${b['backup-id']}/${b['backup-time']}`,
            type: b['backup-type'],
            vmid: b['backup-id'],
            timestamp: new Date(b['backup-time'] * 1000),
            size: b.size || 0,
            verified: b.verification?.state === 'ok',
            encrypted: b.crypt?.mode === 'encrypt',
            files: b.files || []
        }));
    }

    // Get nodes from PVE
    async getNodes(): Promise<NodeInfo[]> {
        if (this.config.type !== 'pve') {
            throw new Error('getNodes is only available for PVE servers');
        }

        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/nodes`, { headers });

        if (!res.ok) throw new Error('Failed to get nodes');
        const data = await res.json() as { data: PVENode[] };

        return data.data.map(n => ({
            id: n.node,
            name: n.node,
            status: n.status,
            cpu: n.cpu || 0,
            memory: {
                used: n.mem || 0,
                total: n.maxmem || 0,
                usagePercent: n.maxmem ? Math.round(((n.mem ?? 0) / n.maxmem) * 100) : 0
            },
            uptime: n.uptime || 0
        }));
    }

    // Get VMs from PVE node
    async getVMs(node: string): Promise<VMInfo[]> {
        if (this.config.type !== 'pve') {
            throw new Error('getVMs is only available for PVE servers');
        }

        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/qemu`, { headers });

        if (!res.ok) throw new Error('Failed to get VMs');
        const data = await res.json() as { data: PVEVM[] };

        return data.data.map(vm => ({
            vmid: vm.vmid,
            name: vm.name || `VM ${vm.vmid}`,
            status: vm.status,
            cpu: vm.cpu || 0,
            memory: {
                used: vm.mem || 0,
                total: vm.maxmem || 0
            },
            disk: vm.disk || 0,
            uptime: vm.uptime || 0,
            tags: vm.tags ? vm.tags.split(',').map(t => t.trim()).filter(Boolean) : []
        }));
    }

    // Remote Migrate (QEMU)
    async remoteMigrate(node: string, vmid: number, params: RemoteMigrateParams): Promise<string> {
        if (this.config.type !== 'pve') throw new Error('Only PVE supports remote-migrate');

        const headers = await this.getHeaders();
        const url = `${this.config.url}/api2/json/nodes/${node}/qemu/${vmid}/remote_migrate`;

        const body = new URLSearchParams({
            'target-vmid': params.targetVmid.toString(),
            'target-endpoint': params.targetEndpoint,
            online: params.online ? '1' : '0'
        });

        if (params.targetBridge) body.append('target-bridge', params.targetBridge);
        if (params.targetStorage) body.append('target-storage', params.targetStorage);

        const res = await this.secureFetch(url, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Migration failed: ${res.status} - ${err}`);
        }

        const data = await res.json() as { data: string }; // Returns UPID
        return data.data;
    }

    // Get Task Status
    async getTaskStatus(node: string, upid: string): Promise<TaskStatus> {
        const headers = await this.getHeaders();
        // UPID must be encoded
        const res = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`, { headers });

        if (!res.ok) throw new Error('Failed to get task status');
        const data = await res.json() as { data: TaskStatus };
        return data.data;
    }

    // Get Task Log
    async getTaskLog(node: string, upid: string): Promise<string[]> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/tasks/${encodeURIComponent(upid)}/log`, { headers });

        if (!res.ok) throw new Error('Failed to get task log');
        const data = await res.json() as { data: { t: string }[] };
        return data.data.map(l => l.t);
    }

    // --- LXC & Templates ---

    async getTemplates(node: string, storage: string): Promise<VztmplContent[]> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/storage/${storage}/content?content=vztmpl`, { headers });
        if (!res.ok) throw new Error('Failed to get templates');
        const data = await res.json() as { data: VztmplContent[] };
        return data.data;
    }

    async getISOs(node: string, storage: string): Promise<IsoContent[]> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/storage/${storage}/content?content=iso`, { headers });
        if (!res.ok) throw new Error('Failed to get ISOs');
        const data = await res.json() as { data: IsoContent[] };
        return data.data;
    }

    async createLXC(node: string, params: LXCCreationParams): Promise<string> {
        const headers = await this.getHeaders();
        const url = `${this.config.url}/api2/json/nodes/${node}/lxc`;

        const body = new URLSearchParams({
            vmid: params.vmid.toString(),
            ostemplate: params.ostemplate,
            hostname: params.hostname,
            cores: params.cores.toString(),
            memory: params.memory.toString(),
            swap: '512',
            storage: params.storage,
            password: params.password,
            'net0': `name=eth0,bridge=vmbr0,ip=dhcp,type=veth` // Default basic net
        });

        // Add ssh key if provided
        if (params.ssh_public_keys) {
            // PVE API expects "ssh-public-keys" (plural) with content (encoded? standard form handled by body)
            body.append('ssh-public-keys', params.ssh_public_keys);
        }

        const res = await this.secureFetch(url, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Failed to create LXC: ${res.status} - ${err}`);
        }

        const data = await res.json() as { data: string }; // UPID
        return data.data;
    }

    async startLXC(node: string, vmid: number): Promise<string> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/lxc/${vmid}/status/start`, {
            method: 'POST',
            headers
        });
        if (!res.ok) throw new Error('Failed to start LXC');
        const data = await res.json() as { data: string };
        return data.data;
    }

    // --- QEMU (VM) Creation ---

    async createVM(node: string, params: VMCreationParams): Promise<string> {
        const headers = await this.getHeaders();
        const url = `${this.config.url}/api2/json/nodes/${node}/qemu`;

        const body = new URLSearchParams({
            vmid: params.vmid.toString(),
            name: params.name,
            memory: params.memory.toString(),
            sockets: '1',
            cores: params.cores.toString(),
            net0: `virtio,bridge=vmbr0`, // Default basic net
            scsi0: `${params.storage}:32`, // Default 32GB disk
            ostype: params.ostype || 'l26', // defaults to Linux 2.6+
        });

        // Add ISO if provided
        if (params.iso) {
            body.append('cdrom', params.iso);
        } else {
            body.append('cdrom', 'none');
        }

        const res = await this.secureFetch(url, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Failed to create VM: ${res.status} - ${err}`);
        }

        const data = await res.json() as { data: string }; // UPID
        return data.data;
    }

    async startVM(node: string, vmid: number): Promise<string> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/qemu/${vmid}/status/start`, {
            method: 'POST',
            headers
        });
        if (!res.ok) throw new Error('Failed to start VM');
        const data = await res.json() as { data: string };
        return data.data;
    }

    async stopVM(node: string, vmid: number): Promise<string> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/qemu/${vmid}/status/stop`, {
            method: 'POST',
            headers
        });
        if (!res.ok) throw new Error('Failed to stop VM');
        const data = await res.json() as { data: string };
        return data.data;
    }

    // --- Cluster Helpers ---

    async getNextId(): Promise<number> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/cluster/nextid`, { headers });
        if (!res.ok) throw new Error('Failed to get next VMID');
        const data = await res.json() as { data: string };
        return parseInt(data.data);
    }

    // --- Guest Agent Exec ---

    async agentExec(node: string, vmid: number, command: string[]): Promise<string> {
        const headers = await this.getHeaders();
        const url = `${this.config.url}/api2/json/nodes/${node}/qemu/${vmid}/agent/exec`;

        // PVE takes command as array of strings, but encoded in params
        // Check API docs: "command" is "command=foo&command=bar"
        const body = new URLSearchParams();
        command.forEach(c => body.append('command', c));

        const res = await this.secureFetch(url, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });

        if (!res.ok) {
            // 500 often means agent not running
            throw new Error(`Agent exec failed (is Qemu Guest Agent running?): ${res.status}`);
        }

        const data = await res.json() as { data: { pid: number } };
        // We really should poll for the result using the pid, but for now we just return PID.
        // Actually, for "install", we want to know it worked.
        // But polling agent/exec-status is complex. Let's return the PID for now.
        return `PID: ${data.data.pid}`;
    }

    // RRD historical data for a node
    async getNodeRRDData(node: string, timeframe: string, cf: string = 'AVERAGE'): Promise<RRDPoint[]> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(
            `${this.config.url}/api2/json/nodes/${node}/rrddata?timeframe=${timeframe}&cf=${cf}`,
            { headers }
        );
        if (!res.ok) throw new Error(`Failed to get node RRD data: ${res.status}`);
        const data = await res.json() as { data: any[] };
        // Proxmox node-level uses memused/memtotal instead of mem/maxmem — normalize
        return (data.data || []).map(normalizeNodeRRDPoint);
    }

    // RRD historical data for a VM (qemu or lxc)
    async getVMRRDData(node: string, vmid: number, type: 'qemu' | 'lxc', timeframe: string, cf: string = 'AVERAGE'): Promise<RRDPoint[]> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(
            `${this.config.url}/api2/json/nodes/${node}/${type}/${vmid}/rrddata?timeframe=${timeframe}&cf=${cf}`,
            { headers }
        );
        if (!res.ok) throw new Error(`Failed to get VM RRD data: ${res.status}`);
        const data = await res.json() as { data: any[] };
        return (data.data || []).map(sanitizeRRDPoint);
    }

    // Cluster resources overview
    async getClusterResources(): Promise<ClusterResource[]> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/cluster/resources`, { headers });
        if (!res.ok) throw new Error(`Failed to get cluster resources: ${res.status}`);
        const data = await res.json() as { data: ClusterResource[] };
        return data.data || [];
    }

    // Node task list
    async getNodeTaskList(node: string, limit: number = 50): Promise<PVETask[]> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(
            `${this.config.url}/api2/json/nodes/${node}/tasks?limit=${limit}`,
            { headers }
        );
        if (!res.ok) throw new Error(`Failed to get node tasks: ${res.status}`);
        const data = await res.json() as { data: PVETask[] };
        return data.data || [];
    }

    // ZFS pools
    async getZFSPools(node: string): Promise<ZFSPool[]> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(
            `${this.config.url}/api2/json/nodes/${node}/disks/zfs`,
            { headers }
        );
        if (!res.ok) throw new Error(`Failed to get ZFS pools: ${res.status}`);
        const data = await res.json() as { data: ZFSPool[] };
        return data.data || [];
    }

    // Storage content (backups per VM)
    async getStorageContent(node: string, storage: string, vmid?: number): Promise<StorageContentItem[]> {
        const headers = await this.getHeaders();
        let url = `${this.config.url}/api2/json/nodes/${node}/storage/${storage}/content?content=backup`;
        if (vmid !== undefined) url += `&vmid=${vmid}`;
        const res = await this.secureFetch(url, { headers });
        if (!res.ok) throw new Error(`Failed to get storage content: ${res.status}`);
        const data = await res.json() as { data: StorageContentItem[] };
        return data.data || [];
    }

    // Get LXC containers from PVE node
    async getLXCs(node: string): Promise<VMInfo[]> {
        if (this.config.type !== 'pve') throw new Error('getLXCs is only available for PVE servers');
        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/lxc`, { headers });
        if (!res.ok) throw new Error('Failed to get LXCs');
        const data = await res.json() as { data: PVEVM[] };
        return data.data.map(vm => ({
            vmid: vm.vmid,
            name: vm.name || `CT ${vm.vmid}`,
            status: vm.status,
            cpu: vm.cpu || 0,
            memory: { used: vm.mem || 0, total: vm.maxmem || 0 },
            disk: vm.disk || 0,
            uptime: vm.uptime || 0,
            tags: vm.tags ? vm.tags.split(',').map(t => t.trim()).filter(Boolean) : []
        }));
    }

    // --- Console / Remote Access ---

    // VNC Proxy for QEMU VMs
    async getVNCProxy(node: string, vmid: number): Promise<{ ticket: string; port: number; upid: string }> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/qemu/${vmid}/vncproxy`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ websocket: '1' }).toString()
        });
        if (!res.ok) throw new Error(`Failed to get VNC proxy: ${res.status}`);
        const data = await res.json() as { data: { ticket: string; port: number; upid: string } };
        return data.data;
    }

    // VNC Proxy for LXC containers
    async getLXCVNCProxy(node: string, vmid: number): Promise<{ ticket: string; port: number; upid: string }> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/lxc/${vmid}/vncproxy`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ websocket: '1' }).toString()
        });
        if (!res.ok) throw new Error(`Failed to get LXC VNC proxy: ${res.status}`);
        const data = await res.json() as { data: { ticket: string; port: number; upid: string } };
        return data.data;
    }

    // Terminal Proxy (shell for LXC, serial for QEMU)
    async getTermProxy(node: string, vmid: number, type: 'qemu' | 'lxc'): Promise<{ ticket: string; port: number; upid: string; user: string }> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/${type}/${vmid}/termproxy`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ websocket: '1' }).toString()
        });
        if (!res.ok) throw new Error(`Failed to get term proxy: ${res.status}`);
        const data = await res.json() as { data: { ticket: string; port: number; upid: string; user: string } };
        return data.data;
    }

    // Node shell proxy
    async getNodeTermProxy(node: string): Promise<{ ticket: string; port: number; upid: string; user: string }> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/termproxy`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ websocket: '1' }).toString()
        });
        if (!res.ok) throw new Error(`Failed to get node term proxy: ${res.status}`);
        const data = await res.json() as { data: { ticket: string; port: number; upid: string; user: string } };
        return data.data;
    }

    // SPICE proxy config for QEMU VMs
    async getSpiceProxy(node: string, vmid: number): Promise<Record<string, string>> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/qemu/${vmid}/spiceproxy`, {
            method: 'POST',
            headers
        });
        if (!res.ok) throw new Error(`Failed to get SPICE proxy: ${res.status}`);
        const data = await res.json() as { data: Record<string, string> };
        return data.data;
    }

    // Guest Agent: read file from VM
    async agentFileRead(node: string, vmid: number, filePath: string): Promise<string> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(
            `${this.config.url}/api2/json/nodes/${node}/qemu/${vmid}/agent/file-read?file=${encodeURIComponent(filePath)}`,
            { headers }
        );
        if (!res.ok) throw new Error(`Agent file-read failed: ${res.status}`);
        const data = await res.json() as { data: { content: string; truncated?: boolean } };
        return data.data.content;
    }

    // Guest Agent: write file to VM (content must be base64 or text)
    async agentFileWrite(node: string, vmid: number, filePath: string, content: string, encode: boolean = true): Promise<void> {
        const headers = await this.getHeaders();
        const res = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/qemu/${vmid}/agent/file-write`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                file: filePath,
                content: content,
                ...(encode ? { encode: '1' } : {})
            }).toString()
        });
        if (!res.ok) throw new Error(`Agent file-write failed: ${res.status}`);
    }

    // Guest Agent: exec command and poll for result
    async agentExecWait(node: string, vmid: number, command: string[], timeoutMs: number = 30000): Promise<{ exitcode: number; stdout: string; stderr: string }> {
        const headers = await this.getHeaders();

        // Start exec
        const body = new URLSearchParams();
        command.forEach(c => body.append('command', c));
        const execRes = await this.secureFetch(`${this.config.url}/api2/json/nodes/${node}/qemu/${vmid}/agent/exec`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });
        if (!execRes.ok) throw new Error(`Agent exec failed (is qemu-guest-agent running?): ${execRes.status}`);
        const execData = await execRes.json() as { data: { pid: number } };
        const pid = execData.data.pid;

        // Poll for result
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            await new Promise(r => setTimeout(r, 1000));
            const statusRes = await this.secureFetch(
                `${this.config.url}/api2/json/nodes/${node}/qemu/${vmid}/agent/exec-status?pid=${pid}`,
                { headers }
            );
            if (!statusRes.ok) continue;
            const statusData = await statusRes.json() as { data: { exited?: boolean; exitcode?: number; 'out-data'?: string; 'err-data'?: string } };
            if (statusData.data.exited) {
                return {
                    exitcode: statusData.data.exitcode ?? -1,
                    stdout: statusData.data['out-data'] ?? '',
                    stderr: statusData.data['err-data'] ?? ''
                };
            }
        }
        throw new Error(`Agent exec timed out after ${timeoutMs}ms`);
    }

    // Get connection info for WebSocket proxy
    getConnectionInfo(): { url: string; ticket: string | null; token: string | undefined; type: 'pve' | 'pbs' } {
        return { url: this.config.url, ticket: this.ticket, token: this.config.token, type: this.config.type };
    }
}

// Type definitions
interface PVEStorage {
    storage: string;
    type: string;
    total?: number;
    used?: number;
    avail?: number;
    content?: string;
    active?: number;
}

interface PBSDatastore {
    name: string;
}

interface PBSSnapshot {
    'backup-type': string;
    'backup-id': string;
    'backup-time': number;
    size?: number;
    verification?: { state: string };
    crypt?: { mode: string };
    files?: string[];
}

interface PVENode {
    node: string;
    status: string;
    cpu?: number;
    mem?: number;
    maxmem?: number;
    uptime?: number;
}

interface PVEVM {
    vmid: number;
    name?: string;
    status: string;
    cpu?: number;
    mem?: number;
    maxmem?: number;
    disk?: number;
    uptime?: number;
    tags?: string;
}

export interface StorageInfo {
    id: string;
    name: string;
    type: string;
    total: number;
    used: number;
    available: number;
    usagePercent: number;
    content: string[];
    active: boolean;
}

export interface BackupInfo {
    id: string;
    type: string;
    vmid: string;
    timestamp: Date;
    size: number;
    verified: boolean;
    encrypted: boolean;
    files: string[];
}

export interface NodeInfo {
    id: string;
    name: string;
    status: string;
    cpu: number;
    memory: {
        used: number;
        total: number;
        usagePercent: number;
    };
    uptime: number;
}

export interface VMInfo {
    vmid: number;
    name: string;
    status: string;
    cpu: number;
    memory: {
        used: number;
        total: number;
    };
    disk: number;
    uptime: number;
    tags: string[];
}

export interface RemoteMigrateParams {
    targetVmid: number;
    targetEndpoint: string;
    targetBridge?: string;
    targetStorage?: string;
    online?: boolean;
}

export interface TaskStatus {
    status: 'running' | 'stopped';
    exitstatus?: string;
    id: string;
    node: string;
    starttime: number;
    type: string;
    upid: string;
    user: string;
}

export interface VztmplContent {
    volid: string;
    size: number;
    format: string;
    content: string;
}

export interface IsoContent {
    volid: string;
    size: number;
    format: string;
    content: string;
}

export interface LXCCreationParams {
    vmid: number;
    ostemplate: string; // "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst"
    hostname: string;
    cores: number;
    memory: number; // MB
    storage: string;
    password: string;
    ssh_public_keys?: string;
}

export interface VMCreationParams {
    vmid: number;
    name: string;
    memory: number; // MB
    cores: number;
    storage: string;
    iso?: string; // e.g. "local:iso/debian.iso"
    ostype?: 'l26' | 'win11';
}

export interface RRDPoint {
    time: number;
    cpu?: number;
    mem?: number;
    maxmem?: number;
    netin?: number;
    netout?: number;
    diskread?: number;
    diskwrite?: number;
    maxdisk?: number;
    disk?: number;
    /** IO wait fraction (node-level, mapped from iowait) */
    diskwait?: number;
    /** Node-level raw fields (before normalization) */
    memused?: number;
    memtotal?: number;
    rootused?: number;
    roottotal?: number;
    iowait?: number;
    [key: string]: number | undefined;
}

/**
 * Proxmox RRD returns null for missing data points.
 * Sanitize to ensure all numeric fields are actual numbers.
 */
function sanitizeRRDPoint(raw: any): RRDPoint {
    const point: RRDPoint = { time: raw.time || 0 };
    for (const key of Object.keys(raw)) {
        if (key === 'time') continue;
        const v = raw[key];
        point[key] = (typeof v === 'number' && isFinite(v)) ? v : undefined;
    }
    return point;
}

/**
 * Proxmox node-level RRD uses different field names than VM-level:
 *   memused/memtotal (not mem/maxmem)
 *   rootused/roottotal (disk space, not diskread/diskwrite)
 *   iowait (fraction, no diskread/diskwrite at node level)
 * Normalize to the standard field names used by our charts.
 */
function normalizeNodeRRDPoint(raw: any): RRDPoint {
    const point = sanitizeRRDPoint(raw);
    // Map node-level names → standard names
    if (point.memused !== undefined && point.mem === undefined) {
        point.mem = point.memused;
    }
    if (point.memtotal !== undefined && point.maxmem === undefined) {
        point.maxmem = point.memtotal;
    }
    if (point.rootused !== undefined && point.disk === undefined) {
        point.disk = point.rootused;
    }
    if (point.roottotal !== undefined && point.maxdisk === undefined) {
        point.maxdisk = point.roottotal;
    }
    // iowait is a fraction (0..1), no separate diskread/diskwrite at node level
    if (point.iowait !== undefined) {
        point.diskwait = point.iowait;
    }
    return point;
}

export interface ClusterResource {
    id: string;
    type: 'node' | 'qemu' | 'lxc' | 'storage' | 'pool';
    node?: string;
    name?: string;
    status?: string;
    cpu?: number;
    maxcpu?: number;
    mem?: number;
    maxmem?: number;
    disk?: number;
    maxdisk?: number;
    uptime?: number;
    vmid?: number;
    template?: number;
}

export interface PVETask {
    upid: string;
    node: string;
    pid: number;
    pstart: number;
    starttime: number;
    endtime?: number;
    type: string;
    id?: string;
    user: string;
    status?: string;
    exitstatus?: string;
}

export interface ZFSPool {
    name: string;
    health: string;
    size: number;
    alloc: number;
    free: number;
    frag: number;
    dedup: number;
    scan?: {
        state?: string;
        end_time?: number;
    };
}

export interface StorageContentItem {
    volid: string;
    content: string;
    format: string;
    size: number;
    ctime?: number;
    vmid?: number;
    notes?: string;
}

export interface ConsoleProxyTicket {
    ticket: string;
    port: number;
    upid: string;
    user?: string;
}
