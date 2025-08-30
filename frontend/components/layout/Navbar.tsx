'use client'

import { useLazyQuery, useQuery } from '@apollo/client'
import { useContext, useEffect } from 'react'
import Link from 'next/link'
import { startCase } from 'lodash'
import { useSearchParams } from 'next/navigation'

import { GetApps } from '@/graphql/queries/getApps.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { AppType, EnvironmentType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'

import { Button } from '../common/Button'
import { StatusIndicator } from '../common/StatusIndicator'
import { LogoMark } from '../common/LogoMark'
import CommandPalette from '../common/CommandPalette'
import UserMenu from '../UserMenu'

import { useParsedRoute } from '@/utils/route'
import { isUUID } from '@/utils/copy'

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

  const BreadCrumbs = () => {
    type Breadcrumb = { label: string; href?: string; isLink?: boolean }

    const breadcrumbs: Breadcrumb[] = [
      { label: team ?? '', href: `/${team}`, isLink: Boolean(team) },
    ]

    if (activeApp) {
      breadcrumbs.push({
        label: activeApp.name,
        href: page ? `/${team}/apps/${activeApp.id}` : undefined,
        isLink: Boolean(page),
      })
    }

    if (!activeApp && context && page === undefined) {
      breadcrumbs.push({
        label: context,
        isLink: false,
      })
    }

    if (page) {
      breadcrumbs.push({
        label: page,
        isLink: Boolean(activeApp),
      })
    }

    if (subPage && !isUUID(subPage)) {
      breadcrumbs.push({
        label: subPage,
        isLink: false,
      })
    }

    if (activeEnv) {
      breadcrumbs.push({
        label: activeEnv.name,
        isLink: false,
      })
    }

    return (
      <div className="flex items-center gap-2 min-w-0 overflow-hidden">
        <Link href="/" className="shrink-0">
          <LogoMark className="size-8 fill-black dark:fill-white" />
        </Link>

        {breadcrumbs.map((crumb, index) => (
          <div key={index} className="flex items-center gap-2 text-sm">
            <span className="shrink-0">/</span>
            {crumb.isLink && crumb.href ? (
              <Link
                href={crumb.href}
                className="capitalize overflow-hidden text-ellipsis whitespace-nowrap text-zinc-500"
              >
                {startCase(crumb.label)}
              </Link>
            ) : (
              <span className="capitalize text-zinc-900 dark:text-zinc-100 overflow-hidden text-ellipsis whitespace-nowrap">
                {startCase(crumb.label)}
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

  useEffect(() => {
    let title = 'Phase'

    if (activeEnv && activeApp) {
      title = `${startCase(activeEnv.name)} – ${startCase(activeApp.name)} – ${startCase(team)} | Phase`
    } else if (activeApp && subPage) {
      title = `${startCase(subPage)} – ${startCase(activeApp.name)} – ${startCase(team)} | Phase`
    } else if (activeApp && page) {
      title = `${startCase(page)} – ${startCase(activeApp.name)} – ${startCase(team)} | Phase`
    } else if (activeApp) {
      title = `${startCase(activeApp.name)} – ${startCase(team)} | Phase`
    } else if (page && context) {
      title = `${startCase(page)} – ${startCase(context)} – ${startCase(team)} | Phase`
    } else if (context) {
      title = `${startCase(context)} – ${startCase(team)} | Phase`
    } else if (team) {
      title = `${startCase(team)} | Phase`
    }

    document.title = title
  }, [activeApp, activeEnv, team, context, page, subPage, tab])

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
