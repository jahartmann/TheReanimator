import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Public routes that don't require authentication
const publicRoutes = ['/login'];

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Allow public routes
    if (publicRoutes.some(route => pathname.startsWith(route))) {
        return NextResponse.next();
    }

    // Allow static files only - API routes now require auth
    if (
        pathname.startsWith('/_next') ||
        pathname.includes('.') // Static files like .ico, .png, etc.
    ) {
        return NextResponse.next();
    }

    // Check for session cookie
    const sessionCookie = request.cookies.get('session');
    const expiresAtCookie = request.cookies.get('session_expires');

    if (!sessionCookie || !expiresAtCookie) {
        // No session - redirect to login
        const loginUrl = new URL('/login', request.url);
        return NextResponse.redirect(loginUrl);
    }

    // Check if session expired
    try {
        const expiresAt = new Date(expiresAtCookie.value);
        if (expiresAt < new Date()) {
            // Session expired - redirect to login
            const loginUrl = new URL('/login', request.url);
            const response = NextResponse.redirect(loginUrl);
            // Clear expired cookies
            response.cookies.delete('session');
            response.cookies.delete('session_expires');
            return response;
        }
    } catch {
        // Invalid date - redirect to login
        const loginUrl = new URL('/login', request.url);
        return NextResponse.redirect(loginUrl);
    }

    // Session exists and is valid - allow access
    // Note: Full session validation happens in server actions
    return NextResponse.next();
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
