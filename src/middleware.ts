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

    // Allow static files and API routes
    if (
        pathname.startsWith('/_next') ||
        pathname.startsWith('/api') ||
        pathname.includes('.') // Static files like .ico, .png, etc.
    ) {
        return NextResponse.next();
    }

    // Check for session cookie
    const sessionCookie = request.cookies.get('session');

    if (!sessionCookie) {
        // No session - redirect to login
        const loginUrl = new URL('/login', request.url);
        return NextResponse.redirect(loginUrl);
    }

    // Session exists - allow access
    // Note: Full session validation happens in server actions
    // Middleware only checks for cookie presence for performance
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
