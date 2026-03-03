/**
 * SSH Error Classification — provides actionable, typed errors for SSH operations.
 */

export type SSHErrorType = 'auth_failed' | 'timeout' | 'connection_refused' | 'host_unreachable' | 'dns_failed' | 'unknown';

export interface ClassifiedSSHError {
    type: SSHErrorType;
    message: string;         // Human-readable
    actionable: string;      // What the user/agent can do
    isTransient: boolean;    // Whether retrying might help
}

export function classifySSHError(error: unknown): ClassifiedSSHError {
    const msg = String(error).toLowerCase();

    if (msg.includes('authentication') || msg.includes('auth') || msg.includes('publickey') || msg.includes('permission denied')) {
        return { type: 'auth_failed', message: 'SSH authentication failed', actionable: 'Check SSH key or password in server settings', isTransient: false };
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
        return { type: 'timeout', message: 'Connection timed out', actionable: 'Server may be slow or overloaded. Try again later.', isTransient: true };
    }
    if (msg.includes('econnrefused') || msg.includes('connection refused')) {
        return { type: 'connection_refused', message: 'SSH port refused connection', actionable: 'Check if SSH service is running on the target server', isTransient: false };
    }
    if (msg.includes('ehostunreach') || msg.includes('no route') || msg.includes('host unreachable')) {
        return { type: 'host_unreachable', message: 'Host unreachable', actionable: 'Check network connectivity and firewall rules', isTransient: true };
    }
    if (msg.includes('enotfound') || msg.includes('getaddrinfo')) {
        return { type: 'dns_failed', message: 'DNS resolution failed', actionable: 'Check hostname/IP in server settings', isTransient: false };
    }
    return { type: 'unknown', message: `SSH error: ${String(error).slice(0, 200)}`, actionable: 'Check server logs for details', isTransient: true };
}
