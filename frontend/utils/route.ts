'use client'

import { useParams, usePathname } from 'next/navigation'

export function useParsedRoute() {
  const params = useParams()
  const pathname = usePathname()
  const segments = pathname?.split('/').filter(Boolean) || []

  const team = params?.team as string | undefined

  const context = segments[1] // apps, access, integrations, etc.

  const appId = context === 'apps' ? segments[2] : undefined

  // /apps/[app]/<page>, or /access/<page>, /integrations/<page>
  const page = context === 'apps' ? segments[3] : segments[2]

  const subPage = context === 'apps' ? segments[4] : segments[3]

  return {
    pathname,
    team,
    context, // apps | access | integrations
    appId, // uuid if apps
    page, // syncing | logs | members | etc.
    subPage, // tokens | additional nesting
  }
}
