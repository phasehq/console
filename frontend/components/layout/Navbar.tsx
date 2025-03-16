import UserMenu from '../UserMenu'
import { useLazyQuery, useQuery } from '@apollo/client'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { usePathname } from 'next/navigation'
import { useContext, useEffect } from 'react'
import { AppType, EnvironmentType } from '@/apollo/graphql'
import Link from 'next/link'
import { Button } from '../common/Button'
import { StatusIndicator } from '../common/StatusIndicator'
import { organisationContext } from '@/contexts/organisationContext'
import clsx from 'clsx'
import { LogoMark } from '../common/LogoMark'
import CommandPalette from '../common/CommandPalette'
import { userHasPermission } from '@/utils/access/permissions'

export const NavBar = (props: { team: string }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanReadApps = userHasPermission(organisation?.role?.permissions, 'Apps', 'read')

  const { data: appsData } = useQuery(GetApps, {
    variables: {
      organisationId: organisation?.id,
    },
    skip: !organisation || !userCanReadApps,
  })
  const [getAppEnvs, { data: appEnvsData }] = useLazyQuery(GetAppEnvironments)

  const orgContext = usePathname()?.split('/')[2]

  const apps = appsData?.apps as AppType[]

  const envs: EnvironmentType[] = appEnvsData?.appEnvironments ?? []

  const appId = usePathname()?.split('/')[3]

  const envId = usePathname()?.split('/')[5]

  const appPage = usePathname()?.split('/')[4]

  const activeApp = orgContext === 'apps' ? apps?.find((app) => app.id === appId) : undefined

  useEffect(() => {
    if (activeApp) getAppEnvs({ variables: { appId: activeApp.id } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeApp])

  const activeEnv = activeApp ? envs.find((env) => env.id === envId) : undefined

  return (
    <header className="pr-8 pl-4 w-full h-16 border-b border-neutral-500/20 fixed top-0 z-20 grid grid-cols-3 gap-4 items-center justify-between text-neutral-500 font-medium text-sm bg-neutral-100/70 dark:bg-neutral-800/20 backdrop-blur-md">
      <div className="flex items-center gap-2 min-w-0 overflow-hidden">
        <Link href="/" className="shrink-0">
          <LogoMark className="size-8 fill-black dark:fill-white" />
        </Link>
        <span className="shrink-0">/</span>

        <Link
          href={`/${props.team}`}
          className={clsx(
            'overflow-hidden text-ellipsis whitespace-nowrap',
            orgContext ? 'text-neutral-500' : 'text-black dark:text-white'
          )}
        >
          {props.team}
        </Link>

        {activeApp && <span className="shrink-0">/</span>}

        {activeApp &&
          (appPage ? (
            <Link
              href={`/${props.team}/apps/${activeApp.id}`}
              className="overflow-hidden text-ellipsis whitespace-nowrap"
            >
              {activeApp.name}
            </Link>
          ) : (
            <span className="text-black dark:text-white overflow-hidden text-ellipsis whitespace-nowrap">
              {activeApp.name}
            </span>
          ))}

        {activeApp && appPage && <span className="shrink-0">/</span>}

        {activeApp && appPage && (
          <span
            className={clsx(
              'capitalize overflow-hidden text-ellipsis whitespace-nowrap',
              activeEnv ? 'text-neutral-500' : 'text-black dark:text-white'
            )}
          >
            {appPage}
          </span>
        )}

        {activeEnv && <span className="shrink-0">/</span>}

        {activeEnv && (
          <span className="text-black dark:text-white overflow-hidden text-ellipsis whitespace-nowrap">
            {activeEnv.name}
          </span>
        )}

        {!activeApp && orgContext && <span className="shrink-0">/</span>}
        {!activeApp && <span className="capitalize text-black dark:text-white">{orgContext}</span>}
      </div>

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
