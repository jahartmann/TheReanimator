/**
 * Compat shim for '@/i18n/routing', 'next-intl/routing', and 'next-intl/navigation'.
 * Maps next-intl's routing/navigation API to react-router-dom equivalents.
 */

import React from 'react';
import {
  Link as RouterLink,
  useNavigate,
  useLocation,
} from 'react-router-dom';

// ─── Link ─────────────────────────────────────────────────────────────────────
// next-intl's Link strips locale prefixes automatically.
// In our SPA there are no locale prefixes in routes, so we pass href through.
export const Link = RouterLink;

// ─── redirect ─────────────────────────────────────────────────────────────────
// Server-side redirect — no-op in client context.
// Components that call this at module level must be migrated separately.
export function redirect(_path: string): never {
  // In a true server context this would redirect; in SPA it's a no-op.
  // Throw to prevent silent failures in logic that expects a redirect.
  throw new Error(`redirect("${_path}") called in client context — use useNavigate() instead`);
}

// ─── usePathname ─────────────────────────────────────────────────────────────
export function usePathname(): string {
  return useLocation().pathname;
}

// ─── useRouter ───────────────────────────────────────────────────────────────
// next-intl's useRouter wraps Next.js router with locale awareness.
// We return an object matching the next/navigation shape.
export function useRouter() {
  const navigate = useNavigate();
  const location = useLocation();
  return {
    push: (path: string) => navigate(path),
    replace: (path: string) => navigate(path, { replace: true }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    pathname: location.pathname,
    prefetch: () => {},
    refresh: () => window.location.reload(),
  };
}

// ─── defineRouting (next-intl/routing stub) ──────────────────────────────────
// next-intl uses this to configure locale-aware routing. No-op in SPA context.
export function defineRouting(config: any) {
  return config;
}

// ─── createNavigation (next-intl/navigation stub) ────────────────────────────
// Returns the same Link/redirect/usePathname/useRouter from this module.
export function createNavigation(_routing: any) {
  return { Link, redirect, usePathname, useRouter };
}

export default { Link, redirect, usePathname, useRouter, defineRouting, createNavigation };
