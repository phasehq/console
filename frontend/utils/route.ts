'use client'

import { useParams, usePathname } from 'next/navigation'

export function useParsedRoute() {
  const params = useParams()
  const pathname = usePathname()
  const segments = pathname?.split('/').filter(Boolean) || []

  const team = params?.team as string | undefined

  const context = segments[1] // apps, access, integrations, etc.

  const appId = context === 'apps' ? segments[2] : undefined

  // envId only appears for: /apps/[app]/environments/[envId]/...
  const envId = context === 'apps' && segments[3] === 'environments' ? segments[4] : undefined

  const page =
    context === 'apps'
      ? segments[3] === 'environments'
        ? segments[5] // in /apps/[app]/environments/[envId]/<page>
        : segments[3] // in /apps/[app]/<page>
      : segments[2] // in /access/<page>, /integrations/<page>

  const subPage =
    context === 'apps'
      ? segments[3] === 'environments'
        ? segments[6] // deeper nesting
        : segments[4]
      : segments[3]

  return {
    pathname,
    team,
    context, // apps | access | integrations
    appId, // uuid if apps
    envId, // uuid if environments route
    page, // syncing | logs | members | etc.
    subPage, // tokens | additional nesting
  }
}
