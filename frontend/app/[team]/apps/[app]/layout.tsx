'use client'

import { Fragment, useContext, useEffect, useState } from 'react'
import { Tab } from '@headlessui/react'
import clsx from 'clsx'
import Link from 'next/link'
import { useLazyQuery } from '@apollo/client'
import { AppType } from '@/apollo/graphql'
import { GetAppDetail } from '@/graphql/queries/getAppDetail.gql'
import { usePathname } from 'next/navigation'
import { organisationContext } from '@/contexts/organisationContext'

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
  const [getApp, { data, loading }] = useLazyQuery(GetAppDetail)
  const app = data?.apps[0] as AppType

  const [tabs, setTabs] = useState([
    {
      name: 'Secrets',
      link: '',
    },
    {
      name: 'Service tokens',
      link: 'tokens',
    },
    {
      name: 'Logs',
      link: 'logs',
    },
    {
      name: 'Members',
      link: 'members',
    },
  ])

  useEffect(() => {
    if (organisation) {
      getApp({
        variables: {
          organisationId: organisation.id,
          appId: params.app,
        },
      })

      if (organisation.role!.toLowerCase() !== 'dev') {
        setTabs((prevTabs) =>
          prevTabs.some((tab) => tab.name === 'Settings')
            ? prevTabs
            : [...prevTabs, { name: 'Settings', link: 'settings' }]
        )
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisation, params.app])

  useEffect(() => {
    const activeTabIndex = () => {
      if (app) {
        const currentUrl = path?.split('/')[4] || ''
        return tabs.findIndex((tab) => tab.link === currentUrl) || 0
      }
      return 0
    }

    setTabIndex(activeTabIndex())
  }, [app, path, tabs])

  return (
    <div
      className="w-full p-8 pb-0 text-black dark:text-white flex flex-col oveflow-y-auto"
      style={{ height: 'calc(100vh - 64px)' }}
    >
      {loading && (
        <div className="dark:bg-neutral-700 bg-neutral-300 rounded-md h-12 w-40 animate-pulse"></div>
      )}
      {app && (
        <div className="flex items-center gap-2 pb-8">
          <h1 className="text-3xl font-bold">{app.name}</h1>
        </div>
      )}

      <Tab.Group selectedIndex={tabIndex} onChange={(index) => setTabIndex(index)}>
        <Tab.List className="flex gap-4 w-full border-b border-neutral-500/20">
          {tabs.map((tab) => (
            <Tab as={Fragment} key={tab.name}>
              {({ selected }) => (
                <Link
                  href={`/${params.team}/apps/${params.app}/${tab.link}`}
                  className={clsx(
                    'p-3 font-medium border-b focus:outline-none',
                    selected ? 'border-emerald-500 font-semibold' : ' border-transparent'
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
