'use client'

import { useParams, usePathname } from 'next/navigation'
import { RESERVED_APP_ROUTE_SEGMENTS } from '@/utils/appLinks'

/** The section, app and page that a console path names */
export const parseRoute = (pathname: string | null) => {
  const segments = pathname?.split('/').filter(Boolean) || []

  const context = segments[1] // apps, access, integrations, etc.

  const appId = context === 'apps' ? segments[2] : undefined

  // /apps/[app]/<page>, or /access/<page>, /integrations/<page>. What follows an app and is not
  // one of its pages is a folder of its secrets grid: still the app's home, whichever folder
  const inApp = context === 'apps'
  const onAppPage = inApp && RESERVED_APP_ROUTE_SEGMENTS.includes(segments[3])
  const page = inApp ? (onAppPage ? segments[3] : undefined) : segments[2]

  const subPage = inApp ? (onAppPage ? segments[4] : undefined) : segments[3]

  return {
    context, // apps | access | integrations
    appId, // uuid if apps
    page, // syncing | logs | members | etc.
    subPage, // tokens | additional nesting
  }
}

export function useParsedRoute() {
  const params = useParams()
  const pathname = usePathname()

  const team = params?.team as string | undefined

  return { pathname, team, ...parseRoute(pathname) }
}
