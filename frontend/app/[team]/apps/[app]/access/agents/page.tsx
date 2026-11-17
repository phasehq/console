'use client'

import { useContext, use } from 'react'
import Link from 'next/link'
import { useQuery } from '@apollo/client'
import { FaBan, FaRobot } from 'react-icons/fa'
import { organisationContext } from '@/contexts/organisationContext'
import { useAppPermissions } from '@/hooks/useAppPermissions'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { GetAppAgentAccess } from '@/graphql/queries/apps/getAppAgentAccess.gql'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { GrantExpiryText } from '@/components/agents/AgentGrantExtras'
import { agentsPath } from '@/utils/agents/routes'
import {
  SSE_REQUIRED_LINE,
  describeAppAccess,
  readAppAccess,
  type EnvironmentRef,
} from '@/utils/agents/appAccess'
import { AppEnvironments } from '@/components/agents/WithheldAsset'

type AgentAccessRow = {
  id: string
  agent: { id: string; name: string }
  workflow: { id: string; name: string }
  connection: { id: string; name: string }
  environments: EnvironmentRef[]
  /** Environments of the app the viewer cannot access, not named. */
  hiddenEnvironmentCount?: number | null
  access: unknown
  expiresAt?: string | null
}

const HEAD = 'px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'

/** Every Agent Workflow that can use this app's secrets, through which Connection. */
export default function AppAgents(props: { params: Promise<{ team: string; app: string }> }) {
  const params = use(props.params)
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { hasPermission } = useAppPermissions(params.app)
  // The server lists Agents to those who may see the app's service accounts.
  const canRead = hasPermission('ServiceAccounts', 'read', true)

  const { data, loading } = useQuery(GetAppAgentAccess, {
    variables: { appId: params.app },
    skip: !organisation || !canRead,
    fetchPolicy: 'cache-and-network',
  })
  const { data: appsData, loading: appsLoading } = useQuery(GetApps, {
    variables: { organisationId: organisation?.id, appId: params.app },
    skip: !organisation,
  })
  const sseEnabled = appsData?.apps?.[0]?.sseEnabled === true
  const rows: AgentAccessRow[] = (data?.appAgentAccess ?? []).filter(Boolean)

  if (!organisation || (loading && !data) || (appsLoading && !appsData))
    return (
      <div className="flex h-full max-h-screen w-full items-center justify-center overflow-y-auto">
        <Spinner size="md" />
      </div>
    )

  if (!canRead)
    return (
      <EmptyState
        title="Access restricted"
        subtitle="You don't have the permissions required to view Agent access to this app."
        graphic={
          <div className="text-center text-7xl text-neutral-300 dark:text-neutral-700">
            <FaBan />
          </div>
        }
      >
        <></>
      </EmptyState>
    )

  return (
    <div className="w-full space-y-6 text-black dark:text-white">
      <div className="px-4">
        <h2 className="text-lg font-bold">Agents</h2>
        <div className="text-neutral-500">
          Agent Workflows that can use this app&apos;s secrets through a Connection
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No Agents"
          subtitle={
            sseEnabled
              ? 'No Agent Workflow can use this app. Grant a Workflow an App secrets Connection to give it access.'
              : SSE_REQUIRED_LINE
          }
          graphic={
            <div className="text-center text-5xl text-neutral-300 dark:text-neutral-700">
              <FaRobot />
            </div>
          }
        >
          <></>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full table-auto divide-y divide-zinc-500/40">
            <thead>
              <tr>
                <th className={HEAD}>Agent</th>
                <th className={HEAD}>Workflow</th>
                <th className={`hidden lg:table-cell ${HEAD}`}>Connection</th>
                <th className={HEAD}>Environments</th>
                <th className={HEAD}>Access</th>
                <th className={HEAD}>Ends</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-500/20">
              {rows.map((row) => {
                const words = describeAppAccess(readAppAccess(row.access))
                const environments = row.environments.map((environment) => environment.name)
                const agentHref = agentsPath(params.team, row.agent.id)
                return (
                  <tr key={row.id} className="align-top text-sm">
                    <td className="px-6 py-2">
                      <Link
                        href={agentHref}
                        title={`Open ${row.agent.name}`}
                        className="flex max-w-[14rem] items-center gap-2 font-medium hover:text-emerald-500"
                      >
                        <FaRobot aria-hidden="true" className="shrink-0 text-neutral-500" />
                        <span className="truncate">{row.agent.name}</span>
                      </Link>
                    </td>
                    <td className="px-6 py-2">
                      <Link
                        href={`${agentHref}?tab=workflows`}
                        title={row.workflow.name}
                        className="block max-w-[12rem] truncate hover:text-emerald-500"
                      >
                        {row.workflow.name}
                      </Link>
                    </td>
                    <td className="hidden px-6 py-2 lg:table-cell">
                      <span
                        title={row.connection.name}
                        className="block max-w-[14rem] truncate text-neutral-500"
                      >
                        {row.connection.name}
                      </span>
                    </td>
                    <td className="px-6 py-2">
                      <span
                        title={environments.join(', ')}
                        className="line-clamp-2 max-w-[16rem] break-words text-xs"
                      >
                        <AppEnvironments
                          environments={row.environments}
                          hiddenEnvironmentCount={row.hiddenEnvironmentCount}
                        />
                      </span>
                    </td>
                    <td className="px-6 py-2 text-xs">
                      <div className="max-w-[18rem] font-medium">{words.allowed}</div>
                      {words.restricted && (
                        <div className="text-neutral-500">{words.restricted}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-2">
                      {row.expiresAt ? (
                        <GrantExpiryText expiresAt={row.expiresAt} />
                      ) : (
                        <span className="text-2xs font-medium text-neutral-500">Until revoked</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
