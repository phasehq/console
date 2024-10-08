'use client'

import { Fragment, useContext, useEffect, useMemo, useState } from 'react'
import { Tab } from '@headlessui/react'
import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { userHasPermission } from '@/utils/access/permissions'
import { organisationContext } from '@/contexts/organisationContext'
import { useRouter } from 'next/router'

export default function AccessLayout({
  params,
  children,
}: {
  params: { team: string }
  children: React.ReactNode
}) {
  const path = usePathname()
  //const router = useRouter()

  const { activeOrganisation } = useContext(organisationContext)

  const [tabIndex, setTabIndex] = useState(0)

  const tabs = useMemo(
    () => [
      {
        name: 'Members',
        link: 'members',
      },
      {
        name: 'Roles',
        link: 'roles',
      },
      {
        name: 'Authentication',
        link: 'authentication',
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
      className="w-full p-8 pb-0 text-black dark:text-white flex flex-col oveflow-y-auto"
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
        <div className="py-6 h-full">{children}</div>
      </Tab.Group>
    </div>
  )
}
