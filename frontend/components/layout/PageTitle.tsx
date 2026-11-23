'use client'

import { useLazyQuery, useQuery } from '@apollo/client'
import { useContext, useEffect, useMemo } from 'react'

import { GetApps } from '@/graphql/queries/getApps.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { AppType, EnvironmentType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { usePageTitle } from '@/hooks/usePageTitle'
import { generatePageTitle, NavigationContext } from '@/utils/navigation'
import { useParsedRoute } from '@/utils/route'

// Where the current route sits: its org, app and environment
export const useNavigationContext = (): NavigationContext => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { team, context, appId, envId, page, subPage } = useParsedRoute()

  const userCanReadApps = userHasPermission(organisation?.role?.permissions, 'Apps', 'read')

  const { data: appsData } = useQuery(GetApps, {
    variables: {
      organisationId: organisation?.id,
    },
    skip: !organisation || !userCanReadApps,
  })

  const [getAppEnvs, { data: appEnvsData }] = useLazyQuery(GetAppEnvironments)

  const apps = (appsData?.apps as AppType[]) || []
  const envs: EnvironmentType[] = appEnvsData?.appEnvironments ?? []

  const activeApp = context === 'apps' ? apps.find((app) => app.id === appId) : undefined
  const activeEnv = activeApp ? envs.find((env) => env.id === envId) : undefined

  useEffect(() => {
    if (activeApp) {
      getAppEnvs({ variables: { appId: activeApp.id } })
    }
  }, [activeApp, getAppEnvs])

  return useMemo(
    () => ({
      team,
      context,
      appId,
      envId,
      page,
      subPage,
      activeApp,
      activeEnv,
    }),
    [team, context, appId, envId, page, subPage, activeApp, activeEnv]
  )
}

// Keeps the browser tab title in step with the route. Renders nothing
export const PageTitle = () => {
  usePageTitle(generatePageTitle(useNavigationContext()))

  return null
}
