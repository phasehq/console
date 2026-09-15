'use client'

import { use, useContext, useMemo, useState } from 'react'
import { useQuery } from '@apollo/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FaChevronRight, FaSearch, FaTimesCircle } from 'react-icons/fa'
import clsx from 'clsx'
import { organisationContext } from '@/contexts/organisationContext'
import { GetAgents } from '@/graphql/queries/agents/getAgents.gql'
import { userHasOrganisationAgentPermission } from '@/utils/access/agents'
import { agentsPath } from '@/utils/agents/routes'
import { Button } from '@/components/common/Button'
import { CreateAgentDialog } from '@/components/agents/AgentDialogs'
import { isAgentActive } from '@/components/agents/AgentEnums'
import {
  AgentBadge,
  AgentEmpty,
  AgentError,
  AgentPageHeader,
  AgentSearchSkeleton,
  AgentTableSkeleton,
  formatAgentDate,
  humanizeAgentValue,
} from '@/components/agents/AgentUI'

type AgentRow = {
  id: string
  name: string
  harnessType: string
  status: string
  lastSeenAt?: string | null
  createdBy?: { id: string; fullName?: string | null; email?: string | null } | null
  memberships: Array<{ id: string } | null>
  workflows: Array<{ id: string } | null>
  activeSessionCount: number
}

export default function AgentsPage(props: { params: Promise<{ team: string }> }) {
  const params = use(props.params)
  const router = useRouter()
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const [search, setSearch] = useState('')
  const canCreateOrganisationAgent =
    !!organisation && userHasOrganisationAgentPermission(organisation, 'create')
  const canCreate = canCreateOrganisationAgent
  const { data, loading, error, refetch } = useQuery(GetAgents, {
    variables: { organisationId: organisation?.id },
    skip: !organisation?.id,
    fetchPolicy: 'cache-and-network',
  })
  const agents: AgentRow[] = (data?.agents || []).filter(Boolean)
  const filtered = useMemo(
    () =>
      agents.filter((agent) => {
        const query = search.toLowerCase()
        return (
          agent.name.toLowerCase().includes(query) ||
          agent.createdBy?.fullName?.toLowerCase().includes(query) ||
          agent.createdBy?.email?.toLowerCase().includes(query)
        )
      }),
    [agents, search]
  )

  if (!organisation || (loading && !data))
    return (
      <div className="space-y-5">
        <AgentPageHeader
          title={`${params.team} Agents`}
          description="Organisation-owned identities with member-scoped workflow access."
        />
        <AgentSearchSkeleton />
        <AgentTableSkeleton rows={5} />
      </div>
    )
  if (error) return <AgentError message={error.message} retry={() => refetch()} />

  return (
    <div className="space-y-5">
      <AgentPageHeader
        title={`${params.team} Agents`}
        description="Organisation-owned identities with member-scoped workflow access."
        action={
          canCreate && organisation?.id ? (
            <CreateAgentDialog
              organisationId={organisation.id}
              onCreated={(id) => router.push(agentsPath(params.team, id))}
            />
          ) : undefined
        }
      />
      {agents.length === 0 ? (
        <AgentEmpty
          title="No AI Agents"
          subtitle="Create an Agent to begin. Phase adds its default workflow automatically."
        >
          {canCreate && organisation?.id ? (
            <CreateAgentDialog
              organisationId={organisation.id}
              onCreated={(id) => router.push(agentsPath(params.team, id))}
            />
          ) : (
            <></>
          )}
        </AgentEmpty>
      ) : (
        <>
          <div className="relative flex max-w-sm items-center rounded-md bg-zinc-100 px-2 dark:bg-zinc-800">
            <FaSearch className="text-neutral-500" />
            <input
              aria-label="Search Agents"
              placeholder="Search Agents or creators"
              className="custom w-full bg-transparent placeholder:text-neutral-500"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch('')}
              className={clsx(
                'text-neutral-500 transition-opacity',
                search ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            >
              <FaTimesCircle />
            </button>
          </div>
          {filtered.length === 0 ? (
            <AgentEmpty title="No matching Agents" subtitle="Try a different Agent or creator." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-neutral-500/20">
              <table className="min-w-full divide-y divide-neutral-500/20 text-sm">
                <thead className="bg-neutral-500/5 text-left text-2xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Agent</th>
                    <th className="px-4 py-3 font-medium">Created by</th>
                    <th className="px-4 py-3 font-medium">Access</th>
                    <th className="px-4 py-3 font-medium">Runtime</th>
                    <th className="px-4 py-3 font-medium">Last seen</th>
                    <th className="px-4 py-3">
                      <span className="sr-only">Manage</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-500/20">
                  {filtered.map((agent) => {
                    return (
                      <tr key={agent.id} className="hover:bg-neutral-500/5">
                        <td className="px-4 py-3">
                          <Link
                            href={agentsPath(params.team, agent.id)}
                            className="font-medium hover:text-emerald-500"
                          >
                            {agent.name}
                          </Link>
                          <div className="mt-1 flex gap-1.5">
                            <AgentBadge tone={isAgentActive(agent.status) ? 'green' : 'red'}>
                              {humanizeAgentValue(agent.status)}
                            </AgentBadge>
                            <AgentBadge>{humanizeAgentValue(agent.harnessType)}</AgentBadge>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                          {agent.createdBy?.fullName || agent.createdBy?.email || 'Unknown'}
                        </td>
                        <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                          {agent.memberships.length} assigned
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium">{agent.activeSessionCount}</span>
                          <span className="text-neutral-500"> active</span>
                          <div className="text-2xs text-neutral-500 mt-0.5">
                            {agent.workflows.length} workflows
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-neutral-500 whitespace-nowrap">
                          {formatAgentDate(agent.lastSeenAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link href={agentsPath(params.team, agent.id)}>
                            <Button variant="secondary">
                              Manage <FaChevronRight />
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
