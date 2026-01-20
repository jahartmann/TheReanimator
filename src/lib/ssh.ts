/**
 * SSH Utility Module
 * Handles SSH connections to Proxmox servers for config backup
 */

import { Client, SFTPWrapper } from 'ssh2';
import fs from 'fs';
import path from 'path';

interface SSHConfig {
    host: string;
    port: number;
    username: string;
    privateKey?: string;
    password?: string;
}

interface FileInfo {
    path: string;
    size: number;
    isDirectory: boolean;
}

export class SSHClient {
    private config: SSHConfig;
    private client: Client;

    constructor(config: SSHConfig) {
        this.config = config;
        this.client = new Client();
    }

    // Connect to the server
    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client.on('ready', () => {
                console.log(`[SSH] Connected to ${this.config.host}`);
                resolve();
            });

            this.client.on('error', (err) => {
                console.error(`[SSH] Connection error:`, err);
                reject(err);
            });

            const connectConfig: any = {
                host: this.config.host,
                port: this.config.port,
                username: this.config.username,
                readyTimeout: 15000, // 15 seconds timeout for handshake
                keepaliveInterval: 20000, // 20s - more aggressive per agent guidelines
                keepaliveCountMax: 15,     // Higher tolerance for saturated networks
                debug: (msg: string) => console.log(`[SSH Debug] ${msg}`)
            };

            if (this.config.privateKey) {
                connectConfig.privateKey = this.config.privateKey;
            } else if (this.config.password) {
                connectConfig.password = this.config.password;
            }

            // Wrap connect in a promise race to handle TCP connection timeouts
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    this.client.destroy(); // Force close
                    reject(new Error('SSH Connection timed out after 10000ms'));
                }, 10000);
            });

            const connectPromise = new Promise<void>((resolveConnect, rejectConnect) => {
                this.client.on('ready', () => {
                    console.log(`[SSH] Connected to ${this.config.host}`);
                    resolveConnect();
                });

                this.client.on('error', (err) => {
                    console.error(`[SSH] Connection error:`, err);
                    rejectConnect(err);
                });

                try {
                    this.client.connect(connectConfig);
                } catch (e) {
                    rejectConnect(e);
                }
            });

            // Return the race
            Promise.race([connectPromise, timeoutPromise])
                .then(() => resolve())
                .catch(err => reject(err));
        });
    }



    // Get execution stream directly (for piping)
    // Get execution stream directly (for piping)
    async getExecStream(command: string, options: { pty?: boolean } = {}): Promise<import('ssh2').ClientChannel> {
        try {
            return await this._getExecStreamCore(command, options);
        } catch (e: any) {
            const msg = e.message || '';
            if (msg.includes('Not connected') || msg.includes('Connection closed') || msg.includes('No response') || msg.toLowerCase().includes('unable to exec')) {
                console.log(`[SSH] Stream init failed (${msg}), reconnecting...`);
                try {
                    await this.reconnect();
                    return await this._getExecStreamCore(command, options);
                } catch (reconnectErr) {
                    console.error('[SSH] Reconnect for stream failed:', reconnectErr);
                    throw e;
                }
            }
            throw e;
        }
    }

    private async _getExecStreamCore(command: string, options: { pty?: boolean } = {}): Promise<import('ssh2').ClientChannel> {
        return new Promise((resolve, reject) => {
            this.client.exec(command, { pty: options.pty }, (err, stream) => {
                if (err) return reject(err);
                resolve(stream);
            });
        });
    }

    // Execute a command
    // Reconnect helper
    async reconnect(): Promise<void> {
        try { this.client.end(); } catch { }
        this.client = new Client();
        await this.connect();
    }

    // Execute a command with auto-reconnect and exponential backoff
    async exec(command: string, timeoutMs: number = 20000, options: { pty?: boolean } = {}): Promise<string> {
        const maxRetries = 3;
        const retryableErrors = [
            'Not connected',
            'Connection closed',
            'read ECONNRESET',
            'No response',
            'unable to exec',
            'ETIMEDOUT',
            'ENETUNREACH',
            'ECONNREFUSED'
        ];

        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this._execCore(command, timeoutMs, options);
            } catch (e: any) {
                lastError = e;
                const msg = (e.message || '').toLowerCase();
                const isRetryable = retryableErrors.some(err => msg.includes(err.toLowerCase()));

                if (!isRetryable || attempt === maxRetries) {
                    throw e;
                }

                // Exponential backoff: 1s, 2s, 4s
                const delay = Math.pow(2, attempt - 1) * 1000;
                console.log(`[SSH] Attempt ${attempt}/${maxRetries} failed (${e.message}), retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));

                try {
                    await this.reconnect();
                } catch (reconnectErr) {
                    console.error(`[SSH] Reconnect attempt ${attempt} failed:`, reconnectErr);
                    // Continue to next retry attempt
                }
            }
        }

        throw lastError || new Error('SSH exec failed after retries');
    }

    private async _execCore(command: string, timeoutMs: number, options: { pty?: boolean }): Promise<string> {
        return new Promise((resolve, reject) => {
            let timeoutId: NodeJS.Timeout;

            // Timeout promise
            const timeoutPromise = new Promise<never>((_, rejectTimeout) => {
                timeoutId = setTimeout(() => {
                    rejectTimeout(new Error(`Command timed out after ${timeoutMs}ms: ${command.substring(0, 50)}...`));
                }, timeoutMs);
            });

            // Execution promise
            const execPromise = new Promise<string>((resolveExec, rejectExec) => {
                this.client.exec(command, { pty: options.pty }, (err, stream) => {
                    if (err) return rejectExec(err);

                    let output = '';
                    let errorOutput = '';

                    stream.on('data', (data: Buffer) => {
                        output += data.toString();
                    });

                    stream.stderr.on('data', (data: Buffer) => {
                        errorOutput += data.toString();
                    });

                    stream.on('close', (code: number | null) => {
                        // Handle various exit scenarios:
                        if (code === 0) {
                            resolveExec(output);
                        } else if (code === null || code === undefined) {
                            // Stream closed without proper exit - could be network issue
                            if (output.trim()) {
                                console.warn('[SSH] Stream closed unexpectedly with output, returning partial result');
                                resolveExec(output);
                            } else {
                                const failMsg = errorOutput.trim() || 'Connection closed unexpectedly';
                                rejectExec(new Error(failMsg));
                            }
                        } else {
                            // Non-zero exit code
                            const failMsg = errorOutput.trim() || output.trim() || `Exit code ${code}`;
                            rejectExec(new Error(failMsg));
                        }
                    });
                });
            });

            // Race them
            Promise.race([execPromise, timeoutPromise])
                .then((result) => {
                    clearTimeout(timeoutId);
                    resolve(result);
                })
                .catch((err) => {
                    clearTimeout(timeoutId);
                    reject(err);
                });
        });
    }

    // Execute a command and pipe output to a Writable stream
    async streamCommand(command: string, destination: NodeJS.WritableStream): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client.exec(command, (err, stream) => {
                if (err) return reject(err);

                stream.pipe(destination);

                stream.on('close', (code: number) => {
                    // Resolve even on non-zero, caller can check logs if needed
                    // Tar often exits with 1 for minor warnings
                    resolve();
                });

                stream.stderr.on('data', (data) => {
                    // Optional: process stderr
                });
            });
        });
    }

    // Get SFTP session
    private async getSFTP(): Promise<SFTPWrapper> {
        return new Promise((resolve, reject) => {
            this.client.sftp((err, sftp) => {
                if (err) reject(err);
                else resolve(sftp);
            });
        });
    }

    // List files in a directory
    async listDir(remotePath: string): Promise<FileInfo[]> {
        const sftp = await this.getSFTP();
        return new Promise((resolve, reject) => {
            sftp.readdir(remotePath, (err, list) => {
                if (err) return reject(err);

                const files: FileInfo[] = list.map(item => ({
                    path: path.join(remotePath, item.filename),
                    size: item.attrs.size,
                    isDirectory: item.attrs.isDirectory()
                }));

                resolve(files);
            });
        });
    }

    // Download a single file
    async downloadFile(remotePath: string, localPath: string): Promise<void> {
        const sftp = await this.getSFTP();

        // Ensure local directory exists
        const localDir = path.dirname(localPath);
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
        }

        return new Promise((resolve, reject) => {
            sftp.fastGet(remotePath, localPath, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Upload a file
    async uploadFile(localPath: string, remotePath: string): Promise<void> {
        const sftp = await this.getSFTP();
        return new Promise((resolve, reject) => {
            sftp.fastPut(localPath, remotePath, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Download a directory recursively
    async downloadDir(remotePath: string, localPath: string, progress?: (file: string) => void): Promise<number> {
        const sftp = await this.getSFTP();
        let fileCount = 0;

        const downloadRecursive = async (remote: string, local: string): Promise<void> => {
            // Ensure local directory exists
            if (!fs.existsSync(local)) {
                fs.mkdirSync(local, { recursive: true });
            }

            const listDir = (dirPath: string): Promise<any[]> => {
                return new Promise((resolve, reject) => {
                    sftp.readdir(dirPath, (err, list) => {
                        if (err) reject(err);
                        else resolve(list || []);
                    });
                });
            };

            try {
                const items = await listDir(remote);

                for (const item of items) {
                    const remoteFull = path.posix.join(remote, item.filename);
                    const localFull = path.join(local, item.filename);

                    if (item.attrs.isDirectory()) {
                        await downloadRecursive(remoteFull, localFull);
                    } else {
                        await new Promise<void>((resolve, reject) => {
                            sftp.fastGet(remoteFull, localFull, (err) => {
                                if (err) reject(err);
                                else {
                                    fileCount++;
                                    if (progress) progress(remoteFull);
                                    resolve();
                                }
                            });
                        });
                    }
                }
            } catch (err) {
                console.error(`[SSH] Error downloading ${remote}:`, err);
                // Continue with other directories
            }
        };

        await downloadRecursive(remotePath, localPath);
        return fileCount;
    }

    // Read file content directly
    async readFile(remotePath: string): Promise<string> {
        const sftp = await this.getSFTP();
        return new Promise((resolve, reject) => {
            let content = '';
            const readStream = sftp.createReadStream(remotePath);

            readStream.on('data', (chunk: Buffer) => {
                content += chunk.toString();
            });

            readStream.on('end', () => {
                resolve(content);
            });

            readStream.on('error', (err: Error) => {
                reject(err);
            });
        });
    }
    async disconnect(): Promise<void> {
        this.client.end();
    }
}

// Helper to create SSH client from server config
// Note: ssh_key column stores password for password auth, or private key for key auth
export function createSSHClient(server: {
    ssh_host?: string;
    ssh_port?: number;
    ssh_user?: string;
    ssh_key?: string; // This can be password OR private key
    url?: string;
}): SSHClient {
    // Extract host from URL if ssh_host not set
    let host = server.ssh_host;
    if (!host && server.url) {
        try {
            const url = new URL(server.url);
            host = url.hostname;
        } catch (e) {
            throw new Error('Kein SSH-Host konfiguriert und konnte nicht aus URL extrahiert werden');
        }
    }

    if (!host) {
        throw new Error('Kein SSH-Host konfiguriert');
    }

    const sshKey = server.ssh_key;

    // Detect if it's a private key (starts with -----BEGIN) or a password
    const isPrivateKey = sshKey && sshKey.trim().startsWith('-----BEGIN');

    return new SSHClient({
        host,
        port: server.ssh_port || 22,
        username: server.ssh_user || 'root',
        privateKey: isPrivateKey ? sshKey : undefined,
        password: !isPrivateKey ? sshKey : undefined
    });
}

