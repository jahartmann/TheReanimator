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
