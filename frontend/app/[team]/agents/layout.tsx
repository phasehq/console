'use client'

import { use, useContext, useMemo } from 'react'
import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { activeAgentTab, agentsPath } from '@/utils/agents/routes'
import { StageBadge } from '@/components/common/StageBadge'

export default function AgentsLayout(props: {
  params: Promise<{ team: string }>
  children: React.ReactNode
}) {
  const params = use(props.params)
  const { children } = props
  const pathname = usePathname()
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const permissions = organisation?.role?.permissions
  // Requests live in the main navigation, with the pending count beside them.
  const tabs = useMemo(
    () =>
      [
        { name: 'Overview', link: '', visible: true },
        { name: 'Agents', link: 'all', visible: true },
        {
          name: 'Connections',
          link: 'connections',
          visible: !!permissions && userHasPermission(permissions, 'AgentConnections', 'read'),
        },
      ].filter((tab) => tab.visible),
    [permissions]
  )
  const activeTab = activeAgentTab(pathname)
  return (
    <div className="w-full text-zinc-900 dark:text-zinc-100">
      <div className="sticky top-0 z-[5] bg-neutral-200 dark:bg-neutral-900">
        <div className="px-3 pt-3 sm:px-4 sm:pt-4 lg:px-6 lg:pt-6">
          <div className="flex items-center gap-2">
            <h1 className="text-lg sm:text-xl font-semibold">AI Agents</h1>
            <StageBadge stage="Beta" />
          </div>
          <p className="text-sm text-neutral-500 mt-0.5">
            Control Agent identities, Connections, and access approvals.
          </p>
        </div>
        {/* overflow-x-auto lives on the wrapper so the tabs' -mb-px underline isn't clipped */}
        <div className="mt-4 w-full overflow-x-auto">
          <nav
            aria-label="Agent sections"
            className="flex gap-2 w-full min-w-max border-b border-neutral-500/20 px-3 sm:px-4 lg:px-6"
          >
            {tabs.map((tab) => (
              <Link
                key={tab.name}
                href={agentsPath(params.team, tab.link)}
                aria-current={activeTab === tab.link ? 'page' : undefined}
                className={clsx(
                  'p-2 text-xs font-medium whitespace-nowrap border-b -mb-px focus:outline-none transition ease',
                  activeTab === tab.link
                    ? 'border-emerald-500 font-semibold text-zinc-900 dark:text-zinc-100'
                    : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                )}
              >
                {tab.name}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      <div className="px-3 py-4 sm:px-4 lg:px-6">{children}</div>
    </div>
  )
}
