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
import { sortAgentWorkflows } from '@/components/agents/AgentEnums'
import {
  AgentAccessDenied,
  AgentBadge,
  AgentEmpty,
  AgentError,
  AgentIdentity,
  AgentPageHeader,
  AgentSearchSkeleton,
  AgentTableSkeleton,
  AgentTime,
  agentCardSurface,
  agentPrimaryAction,
} from '@/components/agents/AgentUI'

type AgentRow = {
  id: string
  name: string
  harnessType: string
  status: string
  lastSeenAt?: string | null
  createdBy?: { id: string; fullName?: string | null; email?: string | null } | null
  memberships: Array<{ id: string } | null>
  workflows: Array<AgentWorkflowSummary | null>
  activeSessionCount: number
}

type AgentWorkflowSummary = { id: string; name: string; createdAt?: string | null }

const VISIBLE_WORKFLOWS = 3

function AgentWorkflowNames({ workflows }: { workflows: AgentRow['workflows'] }) {
  const sorted = sortAgentWorkflows(
    workflows.filter((workflow): workflow is AgentWorkflowSummary => !!workflow)
  )
  const hidden = sorted.slice(VISIBLE_WORKFLOWS)
  if (!sorted.length) return <span className="text-2xs text-neutral-500">None</span>
  return (
    <div className="flex flex-wrap items-center gap-1">
      {sorted.slice(0, VISIBLE_WORKFLOWS).map((workflow) => (
        <AgentBadge key={workflow.id}>
          <span className="max-w-[9rem] truncate" title={workflow.name}>
            {workflow.name}
          </span>
        </AgentBadge>
      ))}
      {hidden.length > 0 && (
        <span
          className="text-2xs text-neutral-500"
          title={hidden.map((workflow) => workflow.name).join(', ')}
        >
          +{hidden.length} more
        </span>
      )}
    </div>
  )
}

export default function AgentsPage(props: { params: Promise<{ team: string }> }) {
  const params = use(props.params)
  const router = useRouter()
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const [search, setSearch] = useState('')
  const canRead = !!organisation && userHasOrganisationAgentPermission(organisation, 'read')
  const canCreateOrganisationAgent =
    !!organisation && userHasOrganisationAgentPermission(organisation, 'create')
  const canCreate = canCreateOrganisationAgent
  const { data, loading, error, refetch } = useQuery(GetAgents, {
    variables: { organisationId: organisation?.id },
    skip: !organisation?.id || !canRead,
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

  const createAgent =
    canCreate && organisation?.id ? (
      <CreateAgentDialog
        organisationId={organisation.id}
        onCreated={(id) => router.push(agentsPath(params.team, id))}
      />
    ) : undefined

  const create = agentPrimaryAction(createAgent, agents.length > 0)

  const header = (
    <AgentPageHeader
      title={`${params.team} Agents`}
      description="Organisation-owned identities with member-scoped Workflow access."
      action={create.header}
    />
  )

  if (!organisation || (canRead && loading && !data))
    return (
      <div className="space-y-5">
        {header}
        <AgentSearchSkeleton />
        <AgentTableSkeleton rows={5} />
      </div>
    )
  if (!canRead)
    return (
      <div className="space-y-5">
        {header}
        <AgentAccessDenied subtitle="You do not have permission to view Agents in this organisation." />
      </div>
    )
  if (error && !data)
    return (
      <div className="space-y-5">
        {header}
        <AgentError message={error.message} retry={() => refetch()} />
      </div>
    )

  return (
    <div className="space-y-5">
      {header}
      {agents.length === 0 ? (
        <AgentEmpty
          title="No Agents yet"
          subtitle="Set up your first Agent to get started. Phase adds its default Workflow automatically."
        >
          {create.empty ?? <></>}
        </AgentEmpty>
      ) : (
        <>
          <div className="relative flex w-full max-w-sm items-center rounded-md bg-zinc-100 px-2 dark:bg-zinc-800">
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
            <div className={clsx(agentCardSurface(), 'overflow-x-auto px-4')}>
              <table className="table-auto min-w-full divide-y divide-zinc-500/40 text-sm">
                <thead>
                  <tr>
                    <th className="py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Agent
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      Created by
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Access
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Workflows
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Activity
                    </th>
                    <th className="px-6 py-3">
                      <span className="sr-only">Manage</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-500/20">
                  {filtered.map((agent) => {
                    return (
                      <tr key={agent.id} className="group">
                        <td className="py-2">
                          <AgentIdentity agent={agent} href={agentsPath(params.team, agent.id)} />
                        </td>
                        <td className="px-6 py-2 text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                          {agent.createdBy?.fullName || agent.createdBy?.email || 'Unknown'}
                        </td>
                        <td className="px-6 py-2 text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                          {agent.memberships.length} assigned
                        </td>
                        <td className="px-6 py-2">
                          <AgentWorkflowNames workflows={agent.workflows} />
                        </td>
                        <td className="px-6 py-2 whitespace-nowrap">
                          <span className="font-medium">{agent.activeSessionCount}</span>
                          <span className="text-neutral-500">
                            {' '}
                            active {agent.activeSessionCount === 1 ? 'session' : 'sessions'}
                          </span>
                          <div className="text-2xs text-neutral-500">
                            {agent.lastSeenAt ? (
                              <>
                                Last seen <AgentTime value={agent.lastSeenAt} />
                              </>
                            ) : (
                              'Never seen'
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-2 text-right">
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
