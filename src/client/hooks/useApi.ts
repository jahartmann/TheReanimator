/**
 * API hooks for the React SPA.
 * Provides useApi<T> for data fetching and apiCall for mutations.
 * Handles 401 → redirect to login automatically.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export interface MutationState {
  loading: boolean;
  error: string | null;
}

// ─── Auth redirect helper ─────────────────────────────────────────────────────

function handleUnauthorized() {
  if (!window.location.pathname.includes('/login')) {
    window.location.href = '/login';
  }
}

// ─── apiCall ─────────────────────────────────────────────────────────────────

export async function apiCall<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (response.status === 401) {
    handleUnauthorized();
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      errorMessage = body.error || body.message || errorMessage;
    } catch {
      try {
        errorMessage = await response.text() || errorMessage;
      } catch { /* ignore */ }
    }
    throw new Error(errorMessage);
  }

  // Handle empty responses (e.g. 204 No Content)
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    return null as unknown as T;
  }

  return response.json() as Promise<T>;
}

// ─── useApi hook ──────────────────────────────────────────────────────────────

export function useApi<T>(url: string, options?: RequestInit): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const fetchCountRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    const fetchId = ++fetchCountRef.current;
    setLoading(true);
    setError(null);

    try {
      const result = await apiCall<T>(url, options || {});
      // Only update state if this is still the latest fetch
      if (fetchId === fetchCountRef.current) {
        setData(result);
      }
    } catch (err: any) {
      if (fetchId === fetchCountRef.current) {
        if (err.message !== 'Unauthorized') {
          setError(err.message || 'An error occurred');
        }
      }
    } finally {
      if (fetchId === fetchCountRef.current) {
        setLoading(false);
      }
    }
  }, [url]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

// ─── useApiMutation hook ──────────────────────────────────────────────────────

export function useApiMutation<TData = any, TBody = any>() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (
      url: string,
      body?: TBody,
      method: 'POST' | 'PUT' | 'DELETE' | 'PATCH' = 'POST'
    ): Promise<TData | null> => {
      setLoading(true);
      setError(null);

      try {
        const result = await apiCall<TData>(url, {
          method,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        return result;
      } catch (err: any) {
        if (err.message !== 'Unauthorized') {
          setError(err.message || 'An error occurred');
        }
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setError(null);
  }, []);

  return { mutate, loading, error, reset };
}

// ─── usePolling hook ─────────────────────────────────────────────────────────
// Polls an endpoint at a given interval. Useful for live stats.

export function usePolling<T>(url: string, intervalMs: number = 5000): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const result = await apiCall<T>(url);
      if (activeRef.current) {
        setData(result);
        setLoading(false);
        setError(null);
      }
    } catch (err: any) {
      if (activeRef.current && err.message !== 'Unauthorized') {
        setError(err.message);
        setLoading(false);
      }
    }
  }, [url]);

  useEffect(() => {
    activeRef.current = true;
    fetchData();
    const timer = setInterval(fetchData, intervalMs);
    return () => {
      activeRef.current = false;
      clearInterval(timer);
    };
  }, [fetchData, intervalMs]);

  return { data, loading, error, refetch: fetchData };
}
