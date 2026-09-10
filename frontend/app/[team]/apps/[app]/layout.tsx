'use client'

import { Fragment, useContext, useEffect, useState, use } from 'react'
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

export default function AppLayout(props: {
  params: Promise<{ team: string; app: string }>
  children: React.ReactNode
}) {
  const params = use(props.params)

  const { children } = props

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
    <div className="w-full pt-3 sm:pt-4 lg:pt-6 text-black dark:text-white flex flex-col overflow-y-auto h-[calc(100dvh_-_56px_-_var(--mobile-tabbar-height))]">
      {loading && (
        <div className="px-3 sm:px-4 lg:px-6 dark:bg-neutral-700 bg-neutral-300 rounded-md h-12 w-40 animate-pulse"></div>
      )}
      {app && (
        <div className="flex shrink-0 items-baseline justify-between pb-3 sm:pb-4 px-3 sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-baseline gap-3 group">
            <h1 className="text-lg sm:text-xl font-bold">{app.name}</h1>
            <div className="hidden opacity-0 group-hover:opacity-100 transition ease md:block">
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
        {/* overflow-x-auto lives on the wrapper so the tabs' -mb-px underline isn't clipped */}
        <div className="w-full shrink-0 overflow-x-auto">
          <Tab.List className="flex gap-0 sm:gap-2 w-full min-w-max border-b border-neutral-500/20 px-3 sm:px-4 lg:px-6">
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
        </div>
        {children}
      </Tab.Group>
    </div>
  )
}
