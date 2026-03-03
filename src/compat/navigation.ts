/**
 * Compat shim for 'next/navigation'.
 * Maps Next.js navigation hooks to react-router-dom equivalents.
 */

import {
  useNavigate,
  useLocation,
  useSearchParams as useRouterSearchParams,
  useParams as useRouterParams,
} from 'react-router-dom';

// ─── useRouter ───────────────────────────────────────────────────────────────
export function useRouter() {
  const navigate = useNavigate();
  const location = useLocation();
  return {
    push: (path: string) => navigate(path),
    replace: (path: string) => navigate(path, { replace: true }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    prefetch: (_path: string) => {},
    refresh: () => window.location.reload(),
    pathname: location.pathname,
  };
}

// ─── usePathname ─────────────────────────────────────────────────────────────
export function usePathname(): string {
  return useLocation().pathname;
}

// ─── useSearchParams ─────────────────────────────────────────────────────────
// Next.js returns a ReadonlyURLSearchParams; react-router returns [params, setParams].
// We return the params object to match common usage: searchParams.get('key')
export function useSearchParams(): URLSearchParams {
  const [params] = useRouterSearchParams();
  return params;
}

// ─── useParams ───────────────────────────────────────────────────────────────
export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useRouterParams() as T;
}

// ─── redirect ────────────────────────────────────────────────────────────────
// Called from server components / middleware in Next.js.
// In client SPA context: programmatic navigation is done via useRouter().
// This no-op prevents import errors in migrated components.
export function redirect(_url: string): never {
  throw new Error(`redirect("${_url}") called in client context — use useRouter().replace() instead`);
}

// ─── notFound ────────────────────────────────────────────────────────────────
export function notFound(): never {
  throw new Error('notFound() called — render a 404 component instead');
}

export default { useRouter, usePathname, useSearchParams, useParams, redirect, notFound };
