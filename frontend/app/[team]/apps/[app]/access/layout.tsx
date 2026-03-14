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
  params: { team: string; app: string }
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
        name: 'Service Tokens',
        link: 'tokens',
        isLegacy: true,
      },
    ],
    []
  )

  useEffect(() => {
    const activeTabIndex = () => {
      const currentUrl = path?.split('/')[5] || ''
      const index = tabs.findIndex((tab) => tab.link === currentUrl)
      return index >= 0 ? index : 0
    }

    setTabIndex(activeTabIndex())
  }, [path, tabs])

  return (
    <div
      className="w-full px-3 sm:px-4 lg:px-6 py-3 sm:py-4 lg:py-6 pb-0 sm:pb-0 lg:pb-0 text-black dark:text-white flex flex-col overflow-y-auto space-y-3 sm:space-y-4 lg:space-y-6 h-[calc(100vh-56px)]"
    >
      <div>
        <h1 className="text-base sm:text-lg font-bold">Access</h1>
        <div className="text-neutral-500">Manage user and service account access in this App</div>
      </div>

      <Tab.Group selectedIndex={tabIndex} onChange={(index) => setTabIndex(index)}>
        <div className="grid grid-cols-[max-content_1fr] gap-3 sm:gap-4 lg:gap-6 h-full divide-x divide-neutral-500/40">
          <Tab.List className="flex flex-col gap-2 w-full ">
            {tabs.map((tab) => (
              <Tab as={Fragment} key={tab.name}>
                {({ selected }) => (
                  <Link
                    href={`/${params.team}/apps/${params.app}/access/${tab.link}`}
                    className={clsx(
                      'p-2 text-xs font-medium border-l rounded-r-lg focus:outline-none transition ease',
                      selected
                        ? 'border-emerald-500 font-semibold bg-zinc-300 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                        : ' border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                    )}
                  >
                    {tab.name}{' '}
                    {tab.isLegacy && (
                      <span className="rounded-full bg-purple-200 dark:bg-purple-900/50 text-neutral-800 dark:text-neutral-300 px-2 py-0.5 text-2xs">
                        Legacy
                      </span>
                    )}
                  </Link>
                )}
              </Tab>
            ))}
          </Tab.List>
          <div className="h-full">{children}</div>
        </div>
      </Tab.Group>
    </div>
  )
}
