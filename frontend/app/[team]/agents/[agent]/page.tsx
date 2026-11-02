'use client'

import { Fragment, use, useContext, useEffect, useState } from 'react'
import { Tab } from '@headlessui/react'
import { useMutation, useQuery } from '@apollo/client'
import clsx from 'clsx'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  FaArrowRight,
  FaChevronLeft,
  FaClock,
  FaEdit,
  FaKey,
  FaPause,
  FaPlay,
  FaPlug,
  FaServer,
  FaTerminal,
  FaTrashAlt,
} from 'react-icons/fa'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { userHasOrganisationAgentPermission } from '@/utils/access/agents'
import { agentsPath } from '@/utils/agents/routes'
import { toastUnhandledError } from '@/utils/errors'
import { GetAgentDetail } from '@/graphql/queries/agents/getAgentDetail.gql'
import { GetAgentAssets } from '@/graphql/queries/agents/getAgentAssets.gql'
import {
  DeleteAgentWorkflowOp,
  RevokeAgentTokenOp,
  RevokeAgentSessionOp,
  RevokeAgentWorkflowGrantOp,
  UpdateAgentOp,
} from '@/graphql/mutations/agents/manageAgents.gql'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import CopyButton from '@/components/common/CopyButton'
import { agentHarnessMeta, agentServiceMeta } from '@/components/agents/AgentBrandIcons'
import { AgentEventLog } from '@/components/agents/AgentEventLog'
import { AgentMembers } from '@/components/agents/AgentMembers'
import {
  agentConnectionUsesHTTP,
  canAllowAgentConnectionHost,
} from '@/components/agents/AgentEventLogUtils'
import {
  agentRequestKindLabel,
  isAgentActive,
  normalizeAgentEnum,
  sortAgentWorkflows,
} from '@/components/agents/AgentEnums'
import {
  byRequestDeadline,
  meshRequestChip,
  type MeshRequestChip,
} from '@/components/agents/AgentMeshUtils'
import {
  agentHostReviewPending,
  type AgentHostRulesMode,
} from '@/components/agents/AgentConnectionHostRules'
import {
  AgentHarnessDialog,
  AgentNameField,
  ConfirmAgentAction,
  CreateWorkflowDialog,
  DeleteAgentDialog,
  EditWorkflowDialog,
  GrantWorkflowDialog,
  MintAgentTokenDialog,
} from '@/components/agents/AgentDialogs'
import {
  AgentBadge,
  AgentAccessDenied,
  AgentDetailSkeleton,
  AgentEmpty,
  AgentError,
  AgentRequestDeadline,
  AgentTime,
  agentCardSurface,
  humanizeAgentValue,
  isActiveSession,
} from '@/components/agents/AgentUI'

type Workflow = {
  id: string
  name: string
  createdAt?: string | null
  grants: Array<{
    id: string
    connection: {
      id: string
      name: string
      serviceType: string
      state: string
      hostRulesVersion: string
      authentication?: {
        id: string
        name: string
        provider?: { id: string; name: string } | null
      } | null
    }
  } | null>
}

type WorkflowGrant = NonNullable<Workflow['grants'][number]>

type AgentSession = {
  id: string
  sessionUid: string
  expiresAt: string
  revokedAt?: string | null
  harnessLabel: string
  lastSeenAt: string
  workflow: { id: string; name: string }
}

const WORKFLOW_STARTER_PROMPT = `Help me connect this workflow to AWS or PostgreSQL through Phase.
Propose the least-privileged credentials to add or migrate through the Phase request flow, then wait for my approval.
After approval, verify access with \`aws sts get-caller-identity\` or \`psql -c "SELECT current_user, current_database();"\`.`

/** A pending request in its Workflow, in the grant row's columns. */
function PendingRequestRow({
  request,
  team,
  now,
}: {
  request: MeshRequestChip
  team: string
  now: number
}) {
  return (
    <li className="grid items-center gap-x-4 gap-y-1 bg-amber-500/10 px-3 py-1.5 text-xs sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_9rem_5.5rem]">
      <span className="flex min-w-0 items-center gap-2 font-medium">
        <span className="shrink-0 text-amber-600 dark:text-amber-400">
          {request.kind === 'CREDENTIAL_UPDATE' ? (
            <FaKey aria-hidden="true" />
          ) : (
            <FaPlug aria-hidden="true" />
          )}
        </span>
        <span className="truncate">{request.targetLabel}</span>
      </span>
      {/* Wraps rather than truncating, so the deadline stays readable. */}
      <span className="min-w-0 text-amber-800 dark:text-amber-300">
        {agentRequestKindLabel(request.kind)} · <AgentRequestDeadline request={request} now={now} />
      </span>
      <span>
        <AgentBadge tone="amber">Pending</AgentBadge>
      </span>
      <span className="flex justify-end">
        <Link href={`${agentsPath(team, 'requests')}?request=${request.id}`}>
          <Button variant="warning" icon={FaArrowRight} iconPosition="right">
            Review
          </Button>
        </Link>
      </span>
    </li>
  )
}

export default function AgentDetailPage(props: {
  params: Promise<{ team: string; agent: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const params = use(props.params)
  const searchParams = use(props.searchParams)
  const router = useRouter()
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const requestedTab = searchParams?.tab
  const [selectedTab, setSelectedTab] = useState(0)
  const organisationPermissions = organisation?.role?.permissions
  const canReadConnections =
    !!organisationPermissions &&
    userHasPermission(organisationPermissions, 'AgentConnections', 'read')
  const canReadAssets = canReadConnections
  const canReadLogs =
    !!organisationPermissions && userHasPermission(organisationPermissions, 'Logs', 'read')
  const canManageConnectionHosts =
    canReadConnections && userHasPermission(organisationPermissions, 'AgentConnections', 'update')
  const canReadTokens =
    !!organisationPermissions && userHasPermission(organisationPermissions, 'AgentTokens', 'read')
  const canReadSessions =
    !!organisationPermissions && userHasPermission(organisationPermissions, 'AgentSessions', 'read')
  const canReadRequests =
    !!organisationPermissions && userHasPermission(organisationPermissions, 'AgentRequests', 'read')
  const { data, loading, error, refetch } = useQuery(GetAgentDetail, {
    variables: {
      organisationId: organisation?.id,
      agentId: params.agent,
      includeSessions: canReadSessions,
      includeRequests: canReadRequests,
    },
    skip: !organisation?.id,
    fetchPolicy: 'cache-and-network',
    pollInterval: 15000,
    skipPollAttempt: () => document.hidden,
  })
  const { data: assetsData } = useQuery(GetAgentAssets, {
    variables: {
      organisationId: organisation?.id,
      includeConnections: canReadAssets,
      includeServiceTemplates: canManageConnectionHosts,
    },
    skip: !organisation?.id || (!canReadAssets && !canManageConnectionHosts),
    fetchPolicy: 'cache-and-network',
  })
  const [updateAgent, { loading: updating }] = useMutation(UpdateAgentOp)
  const [revokeSession] = useMutation(RevokeAgentSessionOp)
  const [revokeGrant] = useMutation(RevokeAgentWorkflowGrantOp)
  const [deleteWorkflow] = useMutation(DeleteAgentWorkflowOp)
  const [revokeToken] = useMutation(RevokeAgentTokenOp)
  const agent = data?.agents?.[0]
  const workflows: Workflow[] = sortAgentWorkflows((data?.agentWorkflows || []).filter(Boolean))
  const agentActive = isAgentActive(agent?.status)
  const canUpdate = userHasOrganisationAgentPermission(organisation, 'update')
  const canDelete = userHasOrganisationAgentPermission(organisation, 'delete')
  const canCreateWorkflow =
    canUpdate &&
    !!organisationPermissions &&
    userHasPermission(organisationPermissions, 'AgentWorkflows', 'create')
  const canUpdateWorkflow =
    !!organisationPermissions &&
    userHasPermission(organisationPermissions, 'AgentWorkflows', 'update')
  const canAllowHosts = canAllowAgentConnectionHost(canUpdateWorkflow, canManageConnectionHosts)
  const canReadMembers =
    !!organisationPermissions &&
    userHasPermission(organisationPermissions, 'AgentMemberships', 'read')
  const canDeleteWorkflow =
    !!organisationPermissions &&
    userHasPermission(organisationPermissions, 'AgentWorkflows', 'delete')
  const canRevokeSession =
    !!organisationPermissions &&
    userHasPermission(organisationPermissions, 'AgentSessions', 'delete')
  const canMintToken =
    !!agent &&
    agentActive &&
    workflows.length > 0 &&
    !!organisationPermissions &&
    userHasPermission(organisationPermissions, 'AgentTokens', 'create')
  const canRevokeToken =
    !!agent &&
    !!organisationPermissions &&
    userHasPermission(organisationPermissions, 'AgentTokens', 'delete')
  const sessions: AgentSession[] = (data?.agentSessions || []).filter(Boolean)
  const connections = (assetsData?.agentConnections || []).filter(Boolean)
  const httpServiceTypes = new Set<string>(
    (assetsData?.agentServiceTemplates || [])
      .filter(
        (service: { protocol?: string | null } | null) =>
          service?.protocol?.toLowerCase() === 'http'
      )
      .map((service: { serviceType: string } | null) => service!.serviceType.toLowerCase())
  )
  const hostRulesModeByService = new Map(
    (assetsData?.agentServiceTemplates || [])
      .filter(Boolean)
      .map((service: { serviceType: string; hostRulesMode?: string | null } | null) => [
        service!.serviceType.toLowerCase(),
        service!.hostRulesMode,
      ])
  )
  const activeSessions = sessions.filter(isActiveSession)
  const pendingRequests: MeshRequestChip[] = (data?.agentRequests || [])
    .filter(Boolean)
    .map(meshRequestChip)
    .sort(byRequestDeadline)
  const requestsByWorkflow = new Map<string, MeshRequestChip[]>()
  for (const request of pendingRequests) {
    if (!request.workflowId) continue
    requestsByWorkflow.set(request.workflowId, [
      ...(requestsByWorkflow.get(request.workflowId) || []),
      request,
    ])
  }
  const now = Date.now()
  const anyGrants = workflows.some((workflow) => workflow.grants.some(Boolean))
  // The backend refuses another host while a Connection's custom hosts await review.
  const hostReviewPendingIds = new Set<string>(
    connections
      .filter((connection: any) =>
        agentHostReviewPending(
          hostRulesModeByService.get(connection.serviceType.toLowerCase()) as
            | AgentHostRulesMode
            | undefined,
          connection
        )
      )
      .map((connection: any) => connection.id)
  )

  useEffect(() => {
    const tabIndex = ['workflows', 'sessions', 'logs', 'tokens', 'members'].indexOf(
      requestedTab?.toLowerCase() || ''
    )
    if (tabIndex >= 0) setSelectedTab(tabIndex)
  }, [requestedTab])

  const toggleStatus = async () => {
    if (!agent) return
    try {
      await updateAgent({
        variables: { agentId: agent.id, status: agentActive ? 'disabled' : 'active' },
        refetchQueries: ['GetAgentDetail', 'GetAgents'],
        awaitRefetchQueries: true,
      })
      toast.success(agentActive ? 'Agent disabled and active sessions revoked' : 'Agent enabled')
    } catch (mutationError) {
      toastUnhandledError(mutationError, 'The operation failed')
    }
  }

  // Organisation context resolves before the not-found state so a slow
  // session never flashes "Agent not found".
  if (!organisation || (loading && !data)) return <AgentDetailSkeleton />
  // A failed poll keeps the last data on screen.
  if (error && !data) return <AgentError message={error.message} retry={() => refetch()} />
  if (!agent)
    return (
      <AgentEmpty
        title="Agent not found"
        subtitle="This Agent does not exist or has not been assigned to you."
      />
    )

  const harness = agentHarnessMeta(agent.harnessType)
  const HarnessIcon = harness.Icon
  const harnessTile = (
    <span className="grid size-20 shrink-0 place-items-center rounded-2xl border border-neutral-500/20 bg-neutral-500/5 transition ease group-hover/tile:border-neutral-500/40">
      <HarnessIcon
        role="img"
        aria-label={`${harness.label} harness`}
        className={`size-10 ${harness.iconClass}`}
      />
    </span>
  )

  const mintToken = canMintToken ? (
    <MintAgentTokenDialog
      agentId={agent.id}
      workflows={workflows.map(({ id, name }) => ({ id, name }))}
      harnessType={agent.harnessType}
      triggerVariant="primary"
    />
  ) : null

  const tabs = [
    { name: 'Workflows', count: workflows.length, pending: pendingRequests.length },
    { name: 'Sessions', count: canReadSessions ? sessions.length : '—' },
    { name: 'Logs', count: canReadLogs ? 'Live' : 0 },
    { name: 'Tokens', count: agent.tokens.length },
    { name: 'Members', count: canReadMembers ? agent.memberships.length : '—' },
  ]

  return (
    <div className="space-y-5">
      <Link
        href={agentsPath(params.team, 'all')}
        className="inline-flex items-center gap-2 text-sm text-neutral-500 transition ease hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        <FaChevronLeft /> Back to Agents
      </Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {canUpdate ? (
            <AgentHarnessDialog agent={agent}>
              {(open) => (
                <button
                  type="button"
                  onClick={open}
                  title="Change harness"
                  aria-label={`Change harness (${harness.label})`}
                  className="group/tile relative shrink-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  {harnessTile}
                  <span className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full bg-white text-neutral-500 opacity-0 shadow ring-1 ring-neutral-500/20 transition ease group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100 dark:bg-zinc-800">
                    <FaEdit className="size-3" />
                  </span>
                </button>
              )}
            </AgentHarnessDialog>
          ) : (
            harnessTile
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <AgentNameField agent={agent} canUpdate={canUpdate} />
            <div className="flex flex-wrap items-center gap-2">
              {/* Offsets the ghost button's padding so the ID lines up with the name. */}
              <div className="-ml-3">
                <CopyButton
                  value={agent.id}
                  buttonVariant="ghost"
                  title="Copy Agent ID to clipboard"
                >
                  <span className="font-mono text-xs text-neutral-500">{agent.id}</span>
                </CopyButton>
              </div>
              <AgentBadge tone={agentActive ? 'green' : 'red'}>
                {humanizeAgentValue(agent.status)}
              </AgentBadge>
              <AgentBadge>{harness.label}</AgentBadge>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1 text-xs text-neutral-500 sm:items-end sm:text-right">
          <span className="flex items-center gap-2 text-sm">
            <FaServer className="text-sky-500" />
            <span className="font-medium text-zinc-900 dark:text-zinc-100">Server-side KMS</span>
          </span>
          <span>
            Created <AgentTime value={agent.createdAt} fallback="at an unknown time" /> by{' '}
            {agent.createdBy?.fullName || agent.createdBy?.email || 'Unknown'}
          </span>
          <span className="flex items-center gap-1.5">
            <FaClock aria-hidden="true" />
            {agent.lastSeenAt ? (
              <span>
                Last seen <AgentTime value={agent.lastSeenAt} />
              </span>
            ) : (
              'Never seen'
            )}
            {canReadSessions && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {activeSessions.length} active{' '}
                  {activeSessions.length === 1 ? 'session' : 'sessions'}
                </span>
              </>
            )}
          </span>
        </div>
      </div>

      <Tab.Group selectedIndex={selectedTab} onChange={setSelectedTab}>
        <div className="flex items-end">
          {/* overflow-x-auto lives on the wrapper so the tabs' -mb-px underline isn't clipped */}
          <div className="min-w-0 flex-1 overflow-x-auto">
            <Tab.List className="flex gap-2 w-full min-w-max border-b border-neutral-500/20">
              {tabs.map((tab) => (
                <Tab as={Fragment} key={tab.name}>
                  {({ selected }) => (
                    <button
                      className={clsx(
                        'p-2 text-xs font-medium whitespace-nowrap border-b -mb-px focus:outline-none transition ease',
                        selected
                          ? 'border-emerald-500 font-semibold text-zinc-900 dark:text-zinc-100'
                          : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                      )}
                    >
                      {tab.name} <span className="ml-1 text-2xs text-neutral-500">{tab.count}</span>
                      {!!tab.pending && (
                        <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-px text-2xs font-semibold text-amber-700 dark:text-amber-400">
                          {tab.pending} pending
                        </span>
                      )}
                    </button>
                  )}
                </Tab>
              ))}
            </Tab.List>
          </div>
          {/* The page's one token action, on every tab; its border continues the tab rule. */}
          {mintToken && (
            <div className="shrink-0 border-b border-neutral-500/20 pb-1.5 pl-3">{mintToken}</div>
          )}
        </div>
        <Tab.Panels className="pt-4">
          <Tab.Panel className="space-y-4">
            {workflows.length === 0 ? (
              <AgentEmpty
                title="No Workflows yet"
                subtitle="Every Agent needs at least one active workflow."
              >
                {canCreateWorkflow ? <CreateWorkflowDialog agentId={agent.id} /> : <></>}
              </AgentEmpty>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-neutral-500">
                    Each Workflow has its own tokens and Connection grants.
                  </p>
                  {canCreateWorkflow && <CreateWorkflowDialog agentId={agent.id} />}
                </div>
                <div className={clsx(agentCardSurface(), 'divide-y divide-neutral-500/20')}>
                  {workflows.map((workflow) => {
                    const grants = workflow.grants.filter(
                      (grant): grant is WorkflowGrant => !!grant
                    )
                    const requests = requestsByWorkflow.get(workflow.id) || []
                    return (
                      <section
                        key={workflow.id}
                        aria-label={`${workflow.name} Workflow`}
                        className="space-y-2 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1">
                            <h3 className="truncate text-sm font-semibold">{workflow.name}</h3>
                            <CopyButton
                              value={workflow.id}
                              buttonVariant="ghost"
                              title="Copy Workflow ID"
                            >
                              <span className="font-mono text-2xs text-neutral-500">
                                {workflow.id.slice(0, 8)}
                              </span>
                            </CopyButton>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            {canUpdateWorkflow && canReadAssets && (
                              <GrantWorkflowDialog
                                workflowId={workflow.id}
                                connections={connections.filter(
                                  (connection: { id: string; state: string }) =>
                                    normalizeAgentEnum(connection.state) === 'ACTIVE' &&
                                    !grants.some((grant) => grant.connection.id === connection.id)
                                )}
                              />
                            )}
                            {canUpdateWorkflow && <EditWorkflowDialog workflow={workflow} />}
                            {canDeleteWorkflow && workflows.length > 1 && (
                              <ConfirmAgentAction
                                title="Delete Workflow"
                                description="Its tokens, grants, config values, and active sessions will be revoked."
                                actionLabel="Delete"
                                onConfirm={async () => {
                                  await deleteWorkflow({
                                    variables: { workflowId: workflow.id },
                                    refetchQueries: ['GetAgentDetail'],
                                    awaitRefetchQueries: true,
                                  })
                                  toast.success('Workflow deleted')
                                }}
                              />
                            )}
                          </div>
                        </div>
                        {!canReadAssets && requests.length === 0 ? (
                          <p className="text-xs text-neutral-500">
                            Connection metadata is restricted for your role.
                          </p>
                        ) : canReadAssets && grants.length === 0 && requests.length === 0 ? (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
                            <FaPlug aria-hidden="true" className="shrink-0" />
                            No Connections granted. This Workflow cannot use third-party credentials
                            yet.
                            {anyGrants && (
                              <CopyButton
                                value={WORKFLOW_STARTER_PROMPT}
                                buttonVariant="ghost"
                                title="Copy example prompt"
                              >
                                <span className="flex items-center gap-1.5">
                                  <FaTerminal aria-hidden="true" /> Copy setup prompt
                                </span>
                              </CopyButton>
                            )}
                          </div>
                        ) : (
                          <>
                            <ul className="divide-y divide-neutral-500/10 overflow-hidden rounded-lg border border-neutral-500/15">
                              {requests.map((request) => (
                                <PendingRequestRow
                                  key={request.id}
                                  request={request}
                                  team={params.team}
                                  now={now}
                                />
                              ))}
                              {/* Requests only need request access; grants need Connection access. */}
                              {(canReadAssets ? grants : []).map((grant) => {
                                const service = agentServiceMeta(grant.connection.serviceType)
                                const credential = grant.connection.authentication
                                return (
                                  <li
                                    key={grant.id}
                                    className="grid items-center gap-x-4 gap-y-1 px-3 py-1 text-xs sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_9rem_5.5rem]"
                                  >
                                    <Link
                                      href={agentsPath(params.team, 'connections')}
                                      title={`Manage ${grant.connection.name}`}
                                      className="flex min-w-0 items-center gap-2 font-medium hover:text-emerald-500"
                                    >
                                      <service.Icon
                                        aria-hidden="true"
                                        className={clsx('size-4 shrink-0', service.iconClass)}
                                      />
                                      <span className="truncate">{grant.connection.name}</span>
                                    </Link>
                                    <span
                                      className="flex min-w-0 items-center gap-1.5 text-neutral-500"
                                      title="Integration credentials"
                                    >
                                      <FaKey aria-hidden="true" className="shrink-0" />
                                      <span className="truncate">
                                        {credential?.name || 'Credentials needed'}
                                        {credential?.provider?.name &&
                                          ` · ${credential.provider.name}`}
                                      </span>
                                    </span>
                                    <span>
                                      <AgentBadge
                                        tone={
                                          normalizeAgentEnum(grant.connection.state) === 'ACTIVE'
                                            ? 'green'
                                            : 'amber'
                                        }
                                      >
                                        {humanizeAgentValue(grant.connection.state)}
                                      </AgentBadge>
                                    </span>
                                    <span className="flex justify-end">
                                      {canUpdateWorkflow && (
                                        <ConfirmAgentAction
                                          title="Revoke Workflow grant"
                                          description="This Workflow will immediately lose access to this Connection."
                                          actionLabel="Revoke"
                                          onConfirm={async () => {
                                            await revokeGrant({
                                              variables: { grantId: grant.id },
                                              refetchQueries: ['GetAgentDetail'],
                                              awaitRefetchQueries: true,
                                            })
                                            toast.success('Workflow grant revoked')
                                          }}
                                        />
                                      )}
                                    </span>
                                  </li>
                                )
                              })}
                            </ul>
                            {!canReadAssets && (
                              <p className="text-xs text-neutral-500">
                                Connection metadata is restricted for your role.
                              </p>
                            )}
                          </>
                        )}
                      </section>
                    )
                  })}
                </div>
                {canReadAssets && !anyGrants && (
                  <div className="rounded-xl border border-neutral-500/20 bg-zinc-950 px-4 py-3.5 text-zinc-100">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-medium">
                        <FaTerminal className="shrink-0 text-emerald-400" aria-hidden="true" />
                        Try this in your Agent
                      </div>
                      <CopyButton
                        value={WORKFLOW_STARTER_PROMPT}
                        buttonVariant="secondary"
                        title="Copy example prompt"
                      />
                    </div>
                    <p className="mt-3 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-zinc-300">
                      {WORKFLOW_STARTER_PROMPT}
                    </p>
                  </div>
                )}
              </>
            )}
          </Tab.Panel>

          <Tab.Panel>
            {!canReadSessions ? (
              <AgentAccessDenied subtitle="You do not have permission to view Agent sessions." />
            ) : sessions.length === 0 ? (
              <AgentEmpty
                title="No sessions"
                subtitle="Sessions appear after an Agent opens a Workflow through the Phase CLI."
              />
            ) : (
              <div className={clsx(agentCardSurface(), 'overflow-x-auto px-4')}>
                <table className="table-auto min-w-full divide-y divide-zinc-500/40 text-sm">
                  <thead>
                    <tr>
                      <th className="py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Session
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Workflow
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        State
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Last seen
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Expires
                      </th>
                      <th className="px-6 py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-500/20">
                    {sessions.map((session) => (
                      <tr key={session.id} className="group">
                        <td className="py-2">
                          <CopyButton value={session.sessionUid} buttonVariant="ghost">
                            <code>{session.sessionUid.slice(0, 12)}…</code>
                          </CopyButton>
                          <div className="text-2xs text-neutral-500 mt-1">
                            {session.harnessLabel || 'Unlabelled harness'}
                          </div>
                        </td>
                        <td className="px-6 py-2">{session.workflow.name}</td>
                        <td className="px-6 py-2">
                          <AgentBadge tone={isActiveSession(session) ? 'green' : 'neutral'}>
                            {session.revokedAt
                              ? 'Revoked'
                              : isActiveSession(session)
                                ? 'Active'
                                : 'Expired'}
                          </AgentBadge>
                        </td>
                        <td className="px-6 py-2 whitespace-nowrap text-neutral-500">
                          <AgentTime value={session.lastSeenAt} />
                        </td>
                        <td className="px-6 py-2 whitespace-nowrap text-neutral-500">
                          <AgentTime value={session.expiresAt} />
                        </td>
                        <td className="px-6 py-2 text-right">
                          {canRevokeSession && isActiveSession(session) && (
                            // On row hover, like the token rows below.
                            <div className="flex justify-end opacity-0 transition ease focus-within:opacity-100 group-hover:opacity-100">
                              <ConfirmAgentAction
                                title="Revoke Agent session"
                                description="The session key will stop working immediately."
                                actionLabel="Revoke"
                                triggerVariant="danger"
                                triggerProps={{ icon: FaTrashAlt }}
                                onConfirm={async () => {
                                  await revokeSession({
                                    variables: { sessionUid: session.sessionUid },
                                    refetchQueries: ['GetAgentDetail'],
                                    awaitRefetchQueries: true,
                                  })
                                  toast.success('Session revoked')
                                }}
                              />
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Tab.Panel>

          <Tab.Panel>
            <AgentEventLog
              organisationId={organisation!.id}
              agentId={agent.id}
              workflows={workflows.map(({ id, name, grants }) => ({
                id,
                name,
                connections: grants
                  .flatMap((grant) => (grant ? [grant] : []))
                  .filter(({ connection }) =>
                    agentConnectionUsesHTTP(connection.serviceType, httpServiceTypes)
                  )
                  .map(({ connection }) => ({
                    id: connection.id,
                    name: connection.name,
                    hostRulesVersion: connection.hostRulesVersion,
                    requiresHostReview:
                      hostRulesModeByService.get(connection.serviceType.toLowerCase()) ===
                      'optional_override',
                    hostReviewPending: hostReviewPendingIds.has(connection.id),
                  })),
              }))}
              sessions={sessions.map(({ sessionUid, workflow }) => ({ sessionUid, workflow }))}
              canRead={canReadLogs}
              canAllowHosts={canAllowHosts}
            />
          </Tab.Panel>

          <Tab.Panel className="space-y-4">
            {canReadTokens && agent.tokens.length > 0 && (
              <p className="text-xs text-neutral-500">
                Each token logs the Phase CLI into one Workflow.
              </p>
            )}
            {!canReadTokens ? (
              <AgentAccessDenied subtitle="You do not have permission to view Agent token metadata." />
            ) : agent.tokens.length === 0 ? (
              <AgentEmpty
                title="No Agent tokens"
                subtitle="Generate a scoped Agent token for an agent-only CLI login."
              />
            ) : (
              <div className={clsx(agentCardSurface(), 'overflow-x-auto px-4')}>
                <table className="table-auto min-w-full divide-y divide-zinc-500/40 text-sm">
                  <thead>
                    <tr>
                      <th className="py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Token
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Workflow
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Created
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Last used
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Expires
                      </th>
                      <th className="px-6 py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-500/20">
                    {agent.tokens.map((token: any) => (
                      <tr key={token.id} className="group">
                        <td className="py-2">
                          <div className="font-medium">{token.name}</div>
                          <div className="font-mono text-2xs text-neutral-500">{token.id}</div>
                        </td>
                        <td className="px-6 py-2">{token.workflow.name}</td>
                        <td className="px-6 py-2 whitespace-nowrap text-neutral-500">
                          <AgentTime value={token.createdAt} />
                        </td>
                        <td className="px-6 py-2 whitespace-nowrap text-neutral-500">
                          <AgentTime value={token.lastUsedAt} />
                        </td>
                        <td className="px-6 py-2 whitespace-nowrap text-neutral-500">
                          <AgentTime value={token.expiresAt} />
                        </td>
                        <td className="px-6 py-2 text-right">
                          {canRevokeToken && (
                            // On row hover, like token rows on service accounts and members.
                            <div className="flex justify-end opacity-0 transition ease focus-within:opacity-100 group-hover:opacity-100">
                              <ConfirmAgentAction
                                title="Revoke Agent token"
                                description="The token and every active session opened with it will stop working immediately."
                                actionLabel="Revoke"
                                triggerVariant="danger"
                                triggerProps={{ icon: FaTrashAlt }}
                                onConfirm={async () => {
                                  await revokeToken({
                                    variables: { tokenId: token.id },
                                    refetchQueries: ['GetAgentDetail'],
                                    awaitRefetchQueries: true,
                                  })
                                  toast.success('Agent token revoked')
                                }}
                              />
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Alert variant="info" icon size="sm">
              <span className="text-xs">
                Agent tokens are endpoint scoped. Token values are revealed once and never available
                from this page.
              </span>
            </Alert>
          </Tab.Panel>

          <Tab.Panel>
            <AgentMembers
              organisationId={organisation.id}
              agentId={agent.id}
              workflows={workflows.map(({ id, name }) => ({ id, name }))}
              createdBy={agent.createdBy}
              canReadMembers={canReadMembers}
              canManageMembers={agent.canManageMembers}
            />
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>

      {(canUpdate || canDelete) && (
        <section aria-label="Danger Zone" className="space-y-2 border-t border-neutral-500/40 pt-4">
          <div>
            <div className="text-base font-medium">Danger Zone</div>
            <div className="text-sm text-neutral-500">
              Disabling can be undone. Deleting cannot.
            </div>
          </div>
          <div className="divide-y divide-red-500/20 rounded-lg bg-red-400/10 ring-1 ring-inset ring-red-500/40">
            {canUpdate && (
              <div className="flex items-center justify-between gap-4 p-3">
                <div>
                  <div
                    className={clsx(
                      'text-sm font-medium',
                      agentActive
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-zinc-900 dark:text-zinc-100'
                    )}
                  >
                    {agentActive ? 'Disable Agent' : 'Enable Agent'}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {agentActive
                      ? 'End its active sessions and refuse new ones until it is enabled again.'
                      : 'Let its tokens open sessions again.'}
                  </div>
                </div>
                <Button
                  variant={agentActive ? 'warning' : 'secondary'}
                  icon={agentActive ? FaPause : FaPlay}
                  isLoading={updating}
                  onClick={toggleStatus}
                >
                  {agentActive ? 'Disable' : 'Enable'}
                </Button>
              </div>
            )}
            {canDelete && (
              <div className="flex items-center justify-between gap-4 p-3">
                <div>
                  <div className="text-sm font-medium text-red-400">Delete Agent</div>
                  <div className="text-xs text-neutral-500">
                    Permanently delete this Agent, its Workflows and its tokens.
                  </div>
                </div>
                <DeleteAgentDialog
                  agentId={agent.id}
                  agentName={agent.name}
                  onDeleted={() => router.replace(agentsPath(params.team, 'all'))}
                />
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
