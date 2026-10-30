'use client'

import { use, useContext, useMemo } from 'react'
import { useQuery } from '@apollo/client'
import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { activeAgentTab, agentsPath } from '@/utils/agents/routes'
import { GetPendingAgentRequestIds } from '@/graphql/queries/agents/getPendingAgentRequestIds.gql'
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
  const canReadRequests = !!permissions && userHasPermission(permissions, 'AgentRequests', 'read')
  const { data: pendingData } = useQuery(GetPendingAgentRequestIds, {
    variables: {
      organisationId: organisation?.id,
    },
    skip: !organisation?.id || !canReadRequests,
    fetchPolicy: 'cache-and-network',
    pollInterval: 10000,
    skipPollAttempt: () => document.hidden,
  })
  const pendingRequestCount = (pendingData?.agentRequests || []).filter(Boolean).length
  const tabs = useMemo(
    () =>
      [
        { name: 'Overview', link: '', visible: true, count: 0 },
        { name: 'Agents', link: 'all', visible: true, count: 0 },
        {
          name: 'Connections',
          link: 'connections',
          visible: !!permissions && userHasPermission(permissions, 'AgentConnections', 'read'),
          count: 0,
        },
        {
          name: 'Requests',
          link: 'requests',
          visible: canReadRequests,
          count: pendingRequestCount,
        },
      ].filter((tab) => tab.visible),
    [permissions, canReadRequests, pendingRequestCount]
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
                {tab.count > 0 && (
                  <span
                    title={`${tab.count} pending request${tab.count === 1 ? '' : 's'}`}
                    className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-2xs font-medium text-amber-700 dark:text-amber-400"
                  >
                    {tab.count > 99 ? '99+' : tab.count}
                  </span>
                )}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      <div className="px-3 py-4 sm:px-4 lg:px-6">{children}</div>
    </div>
  )
}
