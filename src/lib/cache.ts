/**
 * Simple in-memory TTL cache.
 * Survives HMR via globalForCache pattern.
 */

interface CacheEntry<T> {
    data: T;
    expires: number;
}

export class SimpleCache<T> {
    private cache = new Map<string, CacheEntry<T>>();

    get(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expires) {
            this.cache.delete(key);
            return null;
        }
        return entry.data;
    }

    set(key: string, data: T, ttlMs: number): void {
        this.cache.set(key, { data, expires: Date.now() + ttlMs });
    }

    invalidate(key: string): void {
        this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
    }

    has(key: string): boolean {
        return this.get(key) !== null;
    }
}

// Survive HMR in dev
const globalForCache = globalThis as unknown as {
    _serverInfoCache?: SimpleCache<any>;
    _vmListCache?: SimpleCache<any>;
    _nodeStatsCache?: SimpleCache<any>;
    _tagCache?: SimpleCache<any>;
    _nodeNameCache?: SimpleCache<string>;
};

/** Server info cache - 30s TTL */
export const serverInfoCache = globalForCache._serverInfoCache ??= new SimpleCache<any>();

/** VM list cache - 15s TTL */
export const vmListCache = globalForCache._vmListCache ??= new SimpleCache<any>();

/** Node stats cache - 5s TTL */
export const nodeStatsCache = globalForCache._nodeStatsCache ??= new SimpleCache<any>();

/** Tag list cache - 60s TTL */
export const tagCache = globalForCache._tagCache ??= new SimpleCache<any>();

/** Node name cache - 5min TTL (for getServerContext) */
export const nodeNameCache = globalForCache._nodeNameCache ??= new SimpleCache<string>();
