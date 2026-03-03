/**
 * Client-safe stub for scan server actions.
 * Delegates to the /api/scan REST endpoint.
 */

export async function scanEntireInfrastructure(): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('/api/scan', {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { success: false, error: body.error || `HTTP ${response.status}` };
    }
    return response.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function scanAllServers(): Promise<void> {
  await fetch('/api/scan', { method: 'POST', credentials: 'include' });
}
