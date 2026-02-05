import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { NextRequest, NextResponse } from 'next/server';

// Public routes that don't require authentication
const publicRoutes = ['/login'];

// Create i18n middleware
const intlMiddleware = createMiddleware(routing);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip i18n for API routes and static files - let them pass through directly
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Get locale from the pathname
  const locale = routing.locales.find((locale) =>
    pathname.startsWith(`/${locale}`) || pathname === `/${locale}`
  ) || routing.defaultLocale;

  // Get the pathname without locale
  const pathnameWithoutLocale = pathname.replace(new RegExp(`^/${locale}`), '') || '/';

  // Check if it's a public route
  if (publicRoutes.some(route => pathnameWithoutLocale.startsWith(route))) {
    return intlMiddleware(request);
  }

  // Check for session cookie
  const sessionCookie = request.cookies.get('session');
  const expiresAtCookie = request.cookies.get('session_expires');

  if (!sessionCookie || !expiresAtCookie) {
    // No session - redirect to login with locale
    const loginUrl = new URL(`/${locale}/login`, request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Check if session expired
  try {
    const expiresAt = new Date(expiresAtCookie.value);
    if (expiresAt < new Date()) {
      // Session expired - redirect to login with locale and clear cookies
      const loginUrl = new URL(`/${locale}/login`, request.url);
      const response = NextResponse.redirect(loginUrl);
      // Clear expired cookies
      response.cookies.delete('session');
      response.cookies.delete('session_expires');
      return response;
    }
  } catch {
    // Invalid date - redirect to login with locale
    const loginUrl = new URL(`/${locale}/login`, request.url);
    return NextResponse.redirect(loginUrl);
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
