'use client'

import { Fragment, useContext, useEffect, useState } from 'react'
import { Tab } from '@headlessui/react'
import clsx from 'clsx'
import Link from 'next/link'
import { useQuery } from '@apollo/client'
import { AppType } from '@/apollo/graphql'
import { GetAppDetail } from '@/graphql/queries/getAppDetail.gql'
import { usePathname } from 'next/navigation'
import { organisationContext } from '@/contexts/organisationContext'
import CopyButton from '@/components/common/CopyButton'
import { ProgrammaticAccessMenu } from '@/components/contextSnippets/ProgrammaticAccessMenu'
import { EnvTabBar } from './_components/EnvTabBar'
import { EnvSelectionProvider } from './_components/EnvSelectionProvider'
import { SecretsCacheProvider } from './_components/SecretsCacheProvider'
import { AppDescriptionViewer } from '@/components/apps/AppDescriptionViewer'

export default function AppLayout({
  params,
  children,
}: {
  params: { team: string; app: string }
  children: React.ReactNode
}) {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const path = usePathname()
  const [tabIndex, setTabIndex] = useState(0)

  const { data, loading } = useQuery(GetAppDetail, {
    variables: {
      organisationId: organisation!?.id,
      appId: params.app,
    },
    skip: !organisation,
  })
  const app = data?.apps[0] as AppType

  const [tabs, setTabs] = useState([
    {
      name: 'Home',
      link: '',
    },
    {
      name: 'Access',
      link: 'access/members',
    },
    {
      name: 'Syncing',
      link: 'syncing',
    },
    {
      name: 'Logs',
      link: 'logs',
    },
    {
      name: 'Settings',
      link: 'settings',
    },
  ])

  useEffect(() => {
    const activeTabIndex = () => {
      if (app) {
        const currentUrl = path?.split('/')[4] || ''
        const index = tabs.findIndex((tab) => tab.link.split('/')[0] === currentUrl)
        return index >= 0 ? index : 0
      }
      return 0
    }

    setTabIndex(activeTabIndex())
  }, [app, path, tabs])

  // The env tab bar is only shown on the secrets views (cross-env overview,
  // env-specific editors and folder paths) — not on app management pages.
  const currentSegment = path?.split('/')[4] || ''
  const isSecretsRoute = !['access', 'syncing', 'logs', 'settings'].includes(currentSegment)

  return (
    <EnvSelectionProvider appId={params.app}>
    <SecretsCacheProvider appId={params.app}>
    {/* 48px matches the parent's navbar offset (mt-12) exactly — the usual
        56px would leave an 8px gap under the bottom-pinned env tab bar */}
    <div
      className="w-full pt-3 sm:pt-4 lg:pt-6 text-black dark:text-white flex flex-col h-[calc(100vh-48px)]"
    >
      {loading && (
        <div className="px-3 sm:px-4 lg:px-6 dark:bg-neutral-700 bg-neutral-300 rounded-md h-12 w-40 animate-pulse"></div>
      )}
      {app && (
        <div className="flex items-baseline justify-between pb-3 sm:pb-4 px-3 sm:px-4 lg:px-6">
          <div className="flex items-baseline gap-3 group">
            <h1 className="text-lg sm:text-xl font-bold">{app.name}</h1>
            {app.description && (
              <div className="self-center">
                <AppDescriptionViewer
                  appId={app.id}
                  description={app.description}
                  showEditButton
                  trigger="icon"
                />
              </div>
            )}
            <div className="opacity-0 group-hover:opacity-100 transition ease">
              <CopyButton value={app.id} buttonVariant="ghost">
                <span className="text-neutral-500 text-xs font-mono">{app.id}</span>
              </CopyButton>
            </div>
          </div>
          <div>
            <ProgrammaticAccessMenu />
          </div>
        </div>
      )}


      <Tab.Group selectedIndex={tabIndex} onChange={(index) => setTabIndex(index)}>
        <Tab.List className="flex gap-2 w-full border-b border-neutral-500/20 px-3 sm:px-4 lg:px-6">
          {tabs.map((tab) => (
            <Tab as={Fragment} key={tab.name}>
              {({ selected }) => (
                <Link
                  href={`/${params.team}/apps/${params.app}/${tab.link}`}
                  className={clsx(
                    'p-2 text-xs font-medium border-b focus:outline-none -mb-px',
                    selected
                      ? 'border-emerald-500 font-semibold text-zinc-900 dark:text-zinc-100'
                      : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                  )}
                >
                  {tab.name}
                </Link>
              )}
            </Tab>
          ))}
        </Tab.List>
      </Tab.Group>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">{children}</div>

      {isSecretsRoute && <EnvTabBar team={params.team} app={params.app} />}
    </div>
    </SecretsCacheProvider>
    </EnvSelectionProvider>
  )
}
