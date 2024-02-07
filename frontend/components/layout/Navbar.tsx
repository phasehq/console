import UserMenu from '../UserMenu'
import { useLazyQuery } from '@apollo/client'
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

export const NavBar = (props: { team: string }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [getApps, { data: appsData }] = useLazyQuery(GetApps)
  const [getAppEnvs, { data: appEnvsData }] = useLazyQuery(GetAppEnvironments)

  const IS_CLOUD_HOSTED = process.env.APP_HOST || process.env.NEXT_PUBLIC_APP_HOST

  useEffect(() => {
    if (organisation) {
      const fetchData = async () => {
        getApps({
          variables: {
            organisationId: organisation.id,
          },
        })
      }

      fetchData()
    }
  }, [getApps, organisation])

  const apps = appsData?.apps as AppType[]

  const envs: EnvironmentType[] = appEnvsData?.appEnvironments ?? []

  const appId = usePathname()?.split('/')[3]

  const envId = usePathname()?.split('/')[5]

  const appPage = usePathname()?.split('/')[4]

  const activeApp = apps?.find((app) => app.id === appId)

  useEffect(() => {
    if (activeApp) getAppEnvs({ variables: { appId: activeApp.id } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeApp])

  const activeEnv = activeApp ? envs.find((env) => env.id === envId) : undefined

  return (
    <header className="px-8 w-full h-16 border-b border-neutral-500/20 fixed top-0 z-10 flex gap-4 items-center justify-between text-neutral-500 font-medium bg-neutral-100/30 dark:bg-neutral-900/30 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <Link href="/">
          <LogoMark className="w-10 fill-black dark:fill-white" />
        </Link>
        <span>/</span>

        {!activeApp && <span className="text-black dark:text-white">{props.team}</span>}

        {activeApp && <Link href={`/${props.team}`}>{props.team}</Link>}

        {activeApp && <span>/</span>}

        {activeApp &&
          (appPage ? (
            <Link href={`/${props.team}/apps/${activeApp.id}`}>{activeApp.name}</Link>
          ) : (
            <span className="text-black dark:text-white">{activeApp.name}</span>
          ))}

        {appPage && <span>/</span>}

        {appPage && (
          <span
            className={clsx(
              'capitalize',
              activeEnv ? 'text-neutral-500' : 'text-black dark:text-white'
            )}
          >
            {appPage}
          </span>
        )}

        {activeEnv && <span>/</span>}

        {activeEnv && <span className="text-black dark:text-white">{activeEnv.name}</span>}
      </div>
      <div className="flex gap-4 items-center justify-end">
        {IS_CLOUD_HOSTED && <StatusIndicator />}

        <Link href="https://docs.phase.dev" target="_blank">
          <Button variant="secondary">Docs</Button>
        </Link>
        <UserMenu />
      </div>
    </header>
  )
}
