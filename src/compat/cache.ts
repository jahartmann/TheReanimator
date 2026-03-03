/**
 * Compat shim for 'next/cache'.
 * These functions are Next.js-specific cache invalidation APIs.
 * In the Vite/Express world they are no-ops — data fetching uses
 * standard fetch/useEffect patterns with no server-side cache to bust.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function revalidatePath(..._args: any[]): void {
  // No-op in non-Next.js environment
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function revalidateTag(..._args: any[]): void {
  // No-op
}

// unstable_cache wraps a function with Next.js caching.
// Without Next.js, just call the function directly.
export function unstable_cache<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  return fn;
}

export default { revalidatePath, revalidateTag, unstable_cache };
