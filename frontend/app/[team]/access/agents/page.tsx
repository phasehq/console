'use client'

import { use, useContext } from 'react'
import { useQuery } from '@apollo/client'
import Link from 'next/link'
import { FaArrowRight, FaRobot } from 'react-icons/fa'
import { organisationContext } from '@/contexts/organisationContext'
import { agentsPath } from '@/utils/agents/routes'
import { GetAgents } from '@/graphql/queries/agents/getAgents.gql'
import { Button } from '@/components/common/Button'
import { isAgentActive } from '@/components/agents/AgentEnums'
import {
  AgentBadge,
  AgentEmpty,
  AgentError,
  AgentLoading,
  formatAgentDate,
  humanizeAgentValue,
} from '@/components/agents/AgentUI'
type AgentRow = {
  id: string
  name: string
  harnessType: string
  status: string
  lastSeenAt?: string | null
  tokenCount: number
  sessionCount: number
  activeSessionCount: number
  createdBy?: {
    id: string
    fullName?: string | null
    email?: string | null
  } | null
  memberships: Array<{ id: string } | null>
  canManageMembers: boolean
}

export default function AccessAgentsPage(props: { params: Promise<{ team: string }> }) {
  const params = use(props.params)
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { data, loading, error, refetch } = useQuery(GetAgents, {
    variables: { organisationId: organisation?.id },
    skip: !organisation?.id,
    fetchPolicy: 'cache-and-network',
  })
  const agents: AgentRow[] = (data?.agents || []).filter(
    (agent: AgentRow | null): agent is AgentRow => !!agent
  )

  if (loading && !data) return <AgentLoading />
  if (error) return <AgentError message={error.message} retry={() => refetch()} />

  return (
    <section className="space-y-5 px-3 sm:px-4 lg:px-6">
      <div>
        <h2 className="text-base font-medium">Agent identities</h2>
        <p className="mt-0.5 text-sm text-neutral-500">
          Review Agent creators, assigned members, and active runtime sessions.
        </p>
      </div>

      {agents.length === 0 ? (
        <AgentEmpty
          title="No Agent identities visible"
          subtitle="Agents appear here when you create one, receive access, or manage the organisation."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-500/20">
          <table className="min-w-full divide-y divide-neutral-500/20 text-xs">
            <thead className="bg-neutral-500/5 text-left text-2xs uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Created by</th>
                <th className="px-4 py-3">Assigned members</th>
                <th className="px-4 py-3">Runtime</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-500/20">
              {agents.map((agent) => {
                return (
                  <tr key={agent.id} className="hover:bg-neutral-500/5">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-medium">
                        <FaRobot className="shrink-0 text-emerald-500" />
                        <Link
                          href={agentsPath(params.team, agent.id)}
                          className="hover:text-emerald-500"
                        >
                          {agent.name}
                        </Link>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <AgentBadge tone={isAgentActive(agent.status) ? 'green' : 'red'}>
                          {humanizeAgentValue(agent.status)}
                        </AgentBadge>
                        <AgentBadge>{humanizeAgentValue(agent.harnessType)}</AgentBadge>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{agent.createdBy?.fullName || agent.createdBy?.email || 'Unknown'}</div>
                      <div className="mt-0.5 whitespace-nowrap text-2xs text-neutral-500">
                        Last seen {formatAgentDate(agent.lastSeenAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {agent.canManageMembers ? (
                        <>
                          <span className="font-medium">{agent.memberships.length}</span>{' '}
                          <span className="text-neutral-500">explicit assignments</span>
                          <div className="mt-0.5 text-2xs text-neutral-500">
                            Owners and admins have implicit access
                          </div>
                        </>
                      ) : (
                        <span className="text-neutral-500">Restricted</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div>
                        <span className="font-medium">{agent.activeSessionCount}</span>
                        <span className="text-neutral-500"> active sessions</span>
                      </div>
                      <div className="mt-0.5 text-2xs text-neutral-500">
                        {agent.sessionCount} total sessions, {agent.tokenCount} tokens
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={
                            agent.canManageMembers
                              ? `${agentsPath(params.team, agent.id)}?tab=members`
                              : agentsPath(params.team, agent.id)
                          }
                        >
                          <Button variant="secondary">
                            {agent.canManageMembers ? 'Manage access' : 'View Agent'}{' '}
                            <FaArrowRight />
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
