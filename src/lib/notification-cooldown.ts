/**
 * Notification Cooldown — prevents alert spam by rate-limiting notifications per key.
 */

// Map of "server-{id}-{alertType}" -> last notification timestamp
// Survive HMR reloads by persisting on globalThis
const globalForCooldown = globalThis as unknown as { notificationCooldowns?: Map<string, number> };
const notificationCooldowns = globalForCooldown.notificationCooldowns ?? new Map<string, number>();
globalForCooldown.notificationCooldowns = notificationCooldowns;
const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Check if a notification should be sent (returns false if still in cooldown).
 * Automatically records the timestamp when returning true.
 */
export function shouldSendNotification(key: string): boolean {
    const last = notificationCooldowns.get(key);
    if (last && Date.now() - last < COOLDOWN_MS) return false;
    notificationCooldowns.set(key, Date.now());
    return true;
}

/**
 * Reset cooldown for a specific key (e.g., when a server comes back online).
 */
export function resetCooldown(key: string): void {
    notificationCooldowns.delete(key);
}
