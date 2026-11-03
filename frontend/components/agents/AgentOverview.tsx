'use client'

import clsx from 'clsx'
import { type ReactNode } from 'react'
import { useQuery } from '@apollo/client'
import type { IconType } from 'react-icons'
import {
  FaArrowRight,
  FaChevronRight,
  FaExclamationTriangle,
  FaKey,
  FaProjectDiagram,
  FaUsers,
} from 'react-icons/fa'
import type { OrganisationMemberType } from '@/apollo/graphql'
import { Avatar } from '@/components/common/Avatar'
import { Button } from '@/components/common/Button'
import { GetAgentMemberships } from '@/graphql/queries/agents/getAgentMemberships.gql'
import { agentRequestKindLabel } from '@/components/agents/AgentEnums'
import type { MeshRequestChip } from '@/components/agents/AgentMeshUtils'
import {
  AgentRequestDeadline,
  AgentRequestKindIcon,
  AgentRequestReviewLink,
  AgentTime,
  agentCardSurface,
} from '@/components/agents/AgentUI'

export type AgentOverviewTab = 'Workflows' | 'Tokens' | 'Members'

type OverviewToken = {
  id: string
  name: string
  createdAt: string
  lastUsedAt?: string | null
  workflow: { name: string }
}

type OverviewMembership = {
  id: string
  member: { id: string; email?: string | null; fullName?: string | null }
  workflows: Array<{ id: string }>
}

const LIST_LIMIT = 5
const PENDING_LIMIT = 3

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

function ViewAll({
  label,
  onClick,
  variant = 'text',
}: {
  label: string
  onClick: () => void
  variant?: 'text' | 'textWarning'
}) {
  return (
    <Button
      variant={variant}
      icon={FaArrowRight}
      iconPosition="right"
      aria-label={`View all ${label}`}
      onClick={onClick}
    >
      View all
    </Button>
  )
}

function SummaryCard({
  title,
  icon: Icon,
  count,
  onOpen,
  children,
}: {
  title: string
  icon: IconType
  count?: number
  onOpen: () => void
  children: ReactNode
}) {
  return (
    <section aria-label={title} className={clsx(agentCardSurface(), 'flex flex-col px-4 py-3')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-medium">
          <Icon aria-hidden="true" className="size-4 shrink-0 text-neutral-500" />
          {title}
          {count !== undefined && <span className="text-sm text-neutral-500">{count}</span>}
        </h3>
      </div>
      <div className="flex-1 pt-1">{children}</div>
      <div className="flex justify-end pt-2">
        <ViewAll label={title} onClick={onOpen} />
      </div>
    </section>
  )
}

function SummaryList({ items, more }: { items: ReactNode[]; more: number }) {
  return (
    <>
      <ul className="divide-y divide-neutral-500/15">{items}</ul>
      {more > 0 && <p className="pt-2 text-2xs text-neutral-500">and {more} more</p>}
    </>
  )
}

const Muted = ({ children }: { children: ReactNode }) => (
  <p className="py-2 text-xs text-neutral-500">{children}</p>
)

/** One line per request, capped, so a busy Agent does not push the summary off screen. */
function PendingRequests({
  requests,
  team,
  now,
  onViewAll,
}: {
  requests: MeshRequestChip[]
  team: string
  now: number
  onViewAll: () => void
}) {
  const visible = requests.slice(0, PENDING_LIMIT)
  return (
    <section
      aria-label="Pending requests"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2"
    >
      {/* Heavier than the row dividers, to set the heading apart from the requests. */}
      <div className="flex items-center justify-between gap-2 border-b-[1.5px] border-amber-500/30 pb-1.5">
        <h3 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
          <FaExclamationTriangle aria-hidden="true" />
          {plural(requests.length, 'pending request')}
        </h3>
        {requests.length > visible.length && (
          <ViewAll label="pending requests" onClick={onViewAll} variant="textWarning" />
        )}
      </div>
      <ul className="mt-0.5 divide-y divide-amber-500/20">
        {visible.map((request) => (
          <li key={request.id} className="flex items-center gap-2 py-1 text-xs">
            <AgentRequestKindIcon kind={request.kind} />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">
                {request.workflowName}
                <FaChevronRight
                  aria-hidden="true"
                  className="mx-1 inline size-2 text-neutral-500"
                />
                {request.targetLabel}
              </span>
              <span className="ml-2 text-2xs text-amber-800 dark:text-amber-300">
                {agentRequestKindLabel(request.kind)} ·{' '}
                <AgentRequestDeadline request={request} now={now} />
              </span>
            </span>
            <AgentRequestReviewLink team={team} requestId={request.id} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The Agent at a glance: what waits on a decision, then each tab's essentials. */
export function AgentOverview({
  organisationId,
  agentId,
  team,
  workflows,
  tokens,
  pendingRequests,
  canReadTokens,
  canReadMembers,
  now,
  onOpenTab,
}: {
  organisationId: string
  agentId: string
  team: string
  workflows: Array<{ id: string; name: string; grants: unknown[] }>
  tokens: OverviewToken[]
  pendingRequests: MeshRequestChip[]
  canReadTokens: boolean
  canReadMembers: boolean
  now: number
  onOpenTab: (tab: AgentOverviewTab) => void
}) {
  // The Members tab reads the same query, so it opens from the cache.
  const { data: membersData } = useQuery(GetAgentMemberships, {
    variables: { organisationId, agentId },
    skip: !canReadMembers,
    fetchPolicy: 'cache-and-network',
  })
  const memberships: OverviewMembership[] = (membersData?.agentMemberships || []).filter(Boolean)
  const pendingByWorkflow = new Map<string, number>()
  for (const request of pendingRequests) {
    if (request.workflowId) {
      pendingByWorkflow.set(
        request.workflowId,
        (pendingByWorkflow.get(request.workflowId) || 0) + 1
      )
    }
  }
  const newestTokens = [...tokens].sort(
    (left, right) => new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf()
  )

  return (
    <div className="space-y-4">
      {pendingRequests.length > 0 && (
        <PendingRequests
          requests={pendingRequests}
          team={team}
          now={now}
          onViewAll={() => onOpenTab('Workflows')}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <SummaryCard
          title="Workflows"
          icon={FaProjectDiagram}
          count={workflows.length}
          onOpen={() => onOpenTab('Workflows')}
        >
          {workflows.length === 0 ? (
            <Muted>No Workflows yet.</Muted>
          ) : (
            <SummaryList
              more={workflows.length - LIST_LIMIT}
              items={workflows.slice(0, LIST_LIMIT).map((workflow) => {
                const pending = pendingByWorkflow.get(workflow.id) || 0
                return (
                  <li key={workflow.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="truncate text-xs font-medium">{workflow.name}</span>
                    <span className="shrink-0 text-2xs text-neutral-500">
                      {plural(workflow.grants.length, 'grant')}
                      {pending > 0 && (
                        <span className="text-amber-700 dark:text-amber-400">
                          {' '}
                          · {pending} pending
                        </span>
                      )}
                    </span>
                  </li>
                )
              })}
            />
          )}
        </SummaryCard>

        <SummaryCard
          title="Tokens"
          icon={FaKey}
          count={canReadTokens ? tokens.length : undefined}
          onOpen={() => onOpenTab('Tokens')}
        >
          {!canReadTokens ? (
            <Muted>Token details are restricted for your role.</Muted>
          ) : newestTokens.length === 0 ? (
            <Muted>No tokens yet.</Muted>
          ) : (
            <SummaryList
              more={newestTokens.length - LIST_LIMIT}
              items={newestTokens.slice(0, LIST_LIMIT).map((token) => (
                <li key={token.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{token.name}</span>
                    <span className="block truncate text-2xs text-neutral-500">
                      {token.workflow.name}
                    </span>
                  </span>
                  <span className="shrink-0 text-2xs text-neutral-500">
                    {token.lastUsedAt ? (
                      <>
                        Used <AgentTime value={token.lastUsedAt} />
                      </>
                    ) : (
                      'Never used'
                    )}
                  </span>
                </li>
              ))}
            />
          )}
        </SummaryCard>

        <SummaryCard
          title="Members"
          icon={FaUsers}
          count={canReadMembers ? memberships.length : undefined}
          onOpen={() => onOpenTab('Members')}
        >
          {!canReadMembers ? (
            <Muted>Members are restricted for your role.</Muted>
          ) : memberships.length === 0 ? (
            <Muted>No members assigned. Owners and admins have access.</Muted>
          ) : (
            <SummaryList
              more={memberships.length - LIST_LIMIT}
              items={memberships.slice(0, LIST_LIMIT).map((membership) => (
                <li key={membership.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar
                      member={membership.member as OrganisationMemberType}
                      size="sm"
                      showTitle={false}
                    />
                    <span className="truncate text-xs font-medium">
                      {membership.member.fullName || membership.member.email}
                    </span>
                  </span>
                  <span className="shrink-0 text-2xs text-neutral-500">
                    {plural(membership.workflows.length, 'Workflow')}
                  </span>
                </li>
              ))}
            />
          )}
        </SummaryCard>
      </div>
    </div>
  )
}
