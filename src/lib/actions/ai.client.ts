/**
 * Client-safe stub for AI actions.
 * The real ai.ts uses 'use server' which is Next.js-only.
 * This module provides equivalent API-based implementations for the SPA.
 *
 * Components that call getAISettings() in a useEffect will work correctly
 * since the Vite alias replaces the server action import path.
 */

export async function getAISettings(): Promise<{ url: string; model: string; enabled: boolean; provider?: string }> {
  try {
    const response = await fetch('/api/ai/settings', { credentials: 'include' });
    if (!response.ok) return { url: 'http://localhost:11434', model: '', enabled: false };
    return response.json();
  } catch {
    return { url: 'http://localhost:11434', model: '', enabled: false };
  }
}

export async function saveAISettings(url: string, model: string, enabled: boolean): Promise<void> {
  await fetch('/api/settings', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ai_url: url, ai_model: model, ai_enabled: String(enabled) }),
  });
}

// Provide the same interface as the real module for type compat
export type { };
