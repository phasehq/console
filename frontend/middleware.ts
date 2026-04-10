import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Middleware that protects routes by checking for the Django session cookie.
 * Replaces NextAuth's middleware — the Django session is now the single
 * source of truth for authentication state.
 */
export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get('sessionid')

  if (!sessionCookie) {
    const loginUrl = new URL('/login', request.url)
    const fullPath = request.nextUrl.search
      ? `${request.nextUrl.pathname}${request.nextUrl.search}`
      : request.nextUrl.pathname
    loginUrl.searchParams.set('callbackUrl', fullPath)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - login (login page)
     * - register (registration page)
     * - lockbox (public lockbox viewer)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|favicon.svg|assets|login|register|lockbox|api/health).*)',
  ],
}
