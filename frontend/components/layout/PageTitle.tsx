'use client'

import { useQuery } from '@apollo/client'
import { useContext, useMemo } from 'react'

import { GetApps } from '@/graphql/queries/getApps.gql'
import { AppType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { usePageTitle } from '@/hooks/usePageTitle'
import { generatePageTitle, NavigationContext } from '@/utils/navigation'
import { useParsedRoute } from '@/utils/route'
import {
  usePendingAgentRequestCount,
  usePendingRequestFavicon,
  withPendingRequestCount,
} from '@/utils/agents/pendingRequests'

// Where the current route sits: its org and app
const useNavigationContext = (): NavigationContext => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { team, context, appId, page, subPage } = useParsedRoute()

  const userCanReadApps = userHasPermission(organisation?.role?.permissions, 'Apps', 'read')

  const { data: appsData } = useQuery(GetApps, {
    variables: {
      organisationId: organisation?.id,
    },
    skip: !organisation || !userCanReadApps,
  })

  const apps = (appsData?.apps as AppType[]) || []

  const activeApp = context === 'apps' ? apps.find((app) => app.id === appId) : undefined

  return useMemo(
    () => ({
      team,
      context,
      appId,
      page,
      subPage,
      activeApp,
    }),
    [team, context, appId, page, subPage, activeApp]
  )
}

// Keeps the browser tab title in step with the route, and marks the title and favicon while change
// requests are pending, so they show from other tabs. Renders nothing
export const PageTitle = () => {
  const pendingRequestCount = usePendingAgentRequestCount({ poll: true })
  usePageTitle(
    withPendingRequestCount(generatePageTitle(useNavigationContext()), pendingRequestCount)
  )
  usePendingRequestFavicon(pendingRequestCount > 0)

  return null
}
