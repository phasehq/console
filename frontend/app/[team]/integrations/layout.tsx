'use client'

import { Fragment, useContext, useEffect, useMemo, useState, use } from 'react'
import { Tab } from '@headlessui/react'
import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasGlobalAccess, userHasPermission } from '@/utils/access/permissions'
import { getIntegrationPages } from '@/utils/navigation'
import { SidebarContext } from '@/contexts/sidebarContext'
import { useShellExperiment } from '@/utils/shellExperiment'

export default function AccessLayout(props: {
  params: Promise<{ team: string }>
  children: React.ReactNode
}) {
  const params = use(props.params)

  const { children } = props

  const path = usePathname()
  //const router = useRouter()

  const { activeOrganisation } = useContext(organisationContext)

  const [tabIndex, setTabIndex] = useState(0)

  // Log streams export org-wide activity — the backend requires a role with
  // global access on top of the LogStreams permission.
  const userCanReadLogStreams = activeOrganisation
    ? userHasPermission(activeOrganisation.role?.permissions, 'LogStreams', 'read') &&
      userHasGlobalAccess(activeOrganisation.role?.permissions)
    : false

  const tabs = useMemo(() => getIntegrationPages(userCanReadLogStreams), [userCanReadLogStreams])

  // TEMPORARY (utils/shellExperiment.ts): while the sidebar is expanded it lists these pages, so the tab bar repeats it
  const experiment = useShellExperiment()
  const { sidebarState } = useContext(SidebarContext)
  const tabsInSidebar = experiment.hideTabs && sidebarState === 'expanded'

  useEffect(() => {
    const activeTabIndex = () => {
      const currentUrl = path?.split('/')[3] || ''
      const index = tabs.findIndex((tab) => tab.link === currentUrl)
      return index >= 0 ? index : 0
    }

    setTabIndex(activeTabIndex())
  }, [path, tabs])

  return (
    <div className="w-full p-3 sm:p-4 lg:p-6 pb-0 sm:pb-0 lg:pb-0 text-zinc-900 dark:text-zinc-100 flex flex-col overflow-y-auto space-y-3 h-full">
      <div
        className={clsx(
          'space-y-1',
          tabsInSidebar && experiment.hideSectionHeading && 'min-[1025px]:hidden'
        )}
      >
        <h1 className="text-lg sm:text-xl font-semibold">{params.team} Integrations</h1>
        <p className="text-neutral-500">Manage integrations with third-party services</p>
      </div>

      <Tab.Group selectedIndex={tabIndex} onChange={(index) => setTabIndex(index)}>
        <Tab.List
          className={clsx(
            'flex gap-2 w-full border-b border-neutral-500/20',
            tabsInSidebar && 'min-[1025px]:hidden'
          )}
        >
          {tabs.map((tab) => (
            <Tab as={Fragment} key={tab.name}>
              {({ selected }) => (
                <Link
                  href={`/${params.team}/integrations/${tab.link}`}
                  className={clsx(
                    'p-2 text-xs font-medium border-b -mb-px focus:outline-none transition ease',
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
        <div className={clsx('h-full', tabsInSidebar ? 'min-[1025px]:pt-0 py-6' : 'py-6')}>
          {children}
        </div>
      </Tab.Group>
    </div>
  )
}
