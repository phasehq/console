'use client'

import { Fragment, useEffect, useState } from 'react'
import { Tab } from '@headlessui/react'
import clsx from 'clsx'
import Link from 'next/link'
import { useQuery, useLazyQuery } from '@apollo/client'
import { AppType } from '@/apollo/graphql'
import { GetOrganisations } from '@/graphql/queries/getOrganisations.gql'
import { GetAppDetail } from '@/graphql/queries/getAppDetail.gql'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/common/Button'
import { FaCopy } from 'react-icons/fa'

export default function AppLayout({
  params,
  children,
}: {
  params: { team: string; app: string }
  children: React.ReactNode
}) {
  const path = usePathname()
  const [tabIndex, setTabIndex] = useState(0)
  const { data: orgsData } = useQuery(GetOrganisations)
  const [getApp, { data, loading }] = useLazyQuery(GetAppDetail)
  const app = data?.apps[0] as AppType

  useEffect(() => {
    if (orgsData) {
      const organisationId = orgsData.organisations[0].id
      getApp({
        variables: {
          organisationId,
          appId: params.app,
        },
      })
    }
  }, [getApp, orgsData, params.app])

  useEffect(() => {
    const activeTabIndex = () => {
      if (app) {
        const currentUrl = path?.split('/')[4]
        if (currentUrl === '') return 0
        if (currentUrl === 'secrets') return 1
        if (currentUrl === 'tokens') return 2
        if (currentUrl === 'logs') return 3
        if (currentUrl === 'members') return 4
        if (currentUrl === 'settings') return 5
      }
      return 0
    }
    setTabIndex(activeTabIndex())
  }, [app, path])

  const tabs = [
    {
      name: 'Home',
      link: '',
    },
    {
      name: 'Secrets',
      link: 'secrets',
    },
    {
      name: 'Tokens',
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
    {
      name: 'Settings',
      link: 'settings',
    },
  ]

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
