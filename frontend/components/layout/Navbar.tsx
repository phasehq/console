'use client'

import { useLazyQuery, useQuery } from '@apollo/client'
import { useContext, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { startCase } from 'lodash'
import { useSearchParams } from 'next/navigation'

import { GetApps } from '@/graphql/queries/getApps.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { AppType, EnvironmentType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { generateBreadcrumbs, generatePageTitle, NavigationContext } from '@/utils/navigation'

import { Button } from '../common/Button'
import { StatusIndicator } from '../common/StatusIndicator'
import { LogoMark } from '../common/LogoMark'
import CommandPalette from '../common/CommandPalette'
import UserMenu from '../UserMenu'

import { useParsedRoute } from '@/utils/route'

export const NavBar = () => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { team, context, appId, envId, page, subPage } = useParsedRoute()
  const searchParams = useSearchParams()
  const tab = searchParams?.get('tab')

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

  // Create navigation context
  const navigationContext: NavigationContext = useMemo(
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

  const breadcrumbs = generateBreadcrumbs(navigationContext)

  const BreadCrumbs = () => {
    return (
      <div className="flex items-center gap-2 min-w-0 overflow-hidden">
        <Link href="/" className="shrink-0">
          <LogoMark className="size-8 fill-black dark:fill-white" />
        </Link>

        {breadcrumbs.map((crumb, index) => (
          <div key={index} className="flex items-center gap-2 text-xs">
            <span className="shrink-0">/</span>
            {crumb.isLink && crumb.href ? (
              <Link
                href={crumb.href}
                className="capitalize overflow-hidden text-ellipsis whitespace-nowrap text-zinc-500"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="capitalize text-zinc-900 dark:text-zinc-100 overflow-hidden text-ellipsis whitespace-nowrap">
                {crumb.label}
              </span>
            )}
          </div>
        ))}
      </div>
    )
  }

  useEffect(() => {
    if (activeApp) {
      getAppEnvs({ variables: { appId: activeApp.id } })
    }
  }, [activeApp, getAppEnvs])

  // Update page title using the utility
  useEffect(() => {
    document.title = generatePageTitle(navigationContext)
  }, [navigationContext, tab])

  return (
    <header className="pr-8 pl-4 w-full h-16 border-b border-neutral-500/20 fixed top-0 z-10 grid grid-cols-3 gap-4 items-center justify-between text-neutral-500 font-medium text-sm bg-neutral-100/70 dark:bg-neutral-800/20 backdrop-blur-md">
      <BreadCrumbs />

      <div className="flex justify-center w-full">
        <CommandPalette />
      </div>

      <div className="flex gap-4 items-center justify-end">
        <StatusIndicator />
        <Link href="https://docs.phase.dev" target="_blank" className="hidden lg:block">
          <Button variant="secondary">Docs</Button>
        </Link>
        <UserMenu />
      </div>
    </header>
  )
}
