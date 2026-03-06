'use client'

import { Fragment, useContext, useEffect, useMemo, useState } from 'react'
import { Tab } from '@headlessui/react'
import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function AccessLayout({
  params,
  children,
}: {
  params: { team: string }
  children: React.ReactNode
}) {
  const path = usePathname()

  const [tabIndex, setTabIndex] = useState(0)

  const tabs = useMemo(
    () => [
      {
        name: 'Members',
        link: 'members',
      },
      {
        name: 'Service Accounts',
        link: 'service-accounts',
      },
      {
        name: 'Roles',
        link: 'roles',
      },
      {
        name: 'External Identities',
        link: 'identities',
      },
      {
        name: 'Authentication',
        link: 'authentication',
      },
      {
        name: 'Network',
        link: 'network',
      },
    ],
    []
  )

  useEffect(() => {
    const activeTabIndex = () => {
      const currentUrl = path?.split('/')[3] || ''
      const index = tabs.findIndex((tab) => tab.link === currentUrl)
      return index >= 0 ? index : 0
    }

    setTabIndex(activeTabIndex())
  }, [path, tabs])

  return (
    <div
      className="w-full p-8 pb-0 text-zinc-900 dark:text-zinc-100 flex flex-col overflow-y-auto"
      style={{ height: 'calc(100vh - 64px)' }}
    >
      <div className="flex items-center gap-2 pb-8">
        <h1 className="text-3xl font-bold">Access</h1>
      </div>

      <Tab.Group selectedIndex={tabIndex} onChange={(index) => setTabIndex(index)}>
        <Tab.List className="flex gap-4 w-full border-b border-neutral-500/20">
          {tabs.map((tab) => (
            <Tab as={Fragment} key={tab.name}>
              {({ selected }) => (
                <Link
                  href={`/${params.team}/access/${tab.link}`}
                  className={clsx(
                    'p-3 font-medium border-b -mb-px focus:outline-none transition ease',
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
        <div className="py-6 flex-1 overflow-y-auto">{children}</div>
      </Tab.Group>
    </div>
  )
}
