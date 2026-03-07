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

  return (
    <div
      className="w-full pt-8 text-black dark:text-white flex flex-col overflow-y-auto"
      style={{ height: 'calc(100vh - 64px)' }}
    >
      {loading && (
        <div className="px-8 dark:bg-neutral-700 bg-neutral-300 rounded-md h-12 w-40 animate-pulse"></div>
      )}
      {app && (
        <div className="flex items-baseline justify-between pb-6 px-8">
          <div className="flex items-baseline gap-3 group">
            <h1 className="text-3xl font-bold">{app.name}</h1>
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
        <Tab.List className="flex gap-4 w-full border-b border-neutral-500/20 px-8">
          {tabs.map((tab) => (
            <Tab as={Fragment} key={tab.name}>
              {({ selected }) => (
                <Link
                  href={`/${params.team}/apps/${params.app}/${tab.link}`}
                  className={clsx(
                    'p-3 font-medium border-b focus:outline-none -mb-px',
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
        {children}
      </Tab.Group>
    </div>
  )
}
