'use client'

import { Fragment, use, useContext, useEffect, useState } from 'react'
import { Tab } from '@headlessui/react'
import { useMutation, useQuery } from '@apollo/client'
import clsx from 'clsx'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FaArrowLeft, FaKey, FaPause, FaPlay, FaPlug, FaTerminal } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { userHasOrganisationAgentPermission } from '@/utils/access/agents'
import { agentsPath } from '@/utils/agents/routes'
import { GetAgentDetail } from '@/graphql/queries/agents/getAgentDetail.gql'
import { GetAgentAssets } from '@/graphql/queries/agents/getAgentAssets.gql'
import {
  DeleteAgentWorkflowOp,
  RevokeAgentTokenOp,
  RevokeAgentSessionOp,
  RevokeAgentWorkflowGrantOp,
  UpdateAgentOp,
} from '@/graphql/mutations/agents/manageAgents.gql'
import { Button } from '@/components/common/Button'
import CopyButton from '@/components/common/CopyButton'
import { agentHarnessMeta } from '@/components/agents/AgentBrandIcons'
import { AgentEventLog } from '@/components/agents/AgentEventLog'
import { AgentMembers } from '@/components/agents/AgentMembers'
import {
  agentConnectionUsesHTTP,
  canAllowAgentConnectionHost,
} from '@/components/agents/AgentEventLogUtils'
import { isAgentActive } from '@/components/agents/AgentEnums'
import {
  ConfirmAgentAction,
  CreateWorkflowDialog,
  DeleteAgentDialog,
  EditAgentDialog,
  EditWorkflowDialog,
  GrantWorkflowDialog,
  MintAgentTokenDialog,
} from '@/components/agents/AgentDialogs'
import {
  AgentBadge,
  AgentDetailSkeleton,
  AgentEmpty,
  AgentError,
  AgentPanel,
  formatAgentDate,
  humanizeAgentValue,
  isActiveSession,
} from '@/components/agents/AgentUI'

type Workflow = {
  id: string
  name: string
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
        revision: string
        provider?: { id: string; name: string } | null
      } | null
    }
  } | null>
}

type AgentSession = {
  id: string
  sessionUid: string
  expiresAt: string
  maxExpiresAt?: string | null
  revokedAt?: string | null
  lastValidatedAt?: string | null
  credentialRotatedAt?: string | null
  harnessLabel: string
  createdAt: string
  lastSeenAt: string
  clientInfo?: Record<string, unknown> | null
  workflow: { id: string; name: string }
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'The operation failed'

const WORKFLOW_STARTER_PROMPT = `Help me connect this workflow to AWS or PostgreSQL through Phase.
Propose the least-privileged credentials to add or migrate through the Phase request flow, then wait for my approval.
After approval, verify access with \`aws sts get-caller-identity\` or \`psql -c "SELECT current_user, current_database();"\`.`

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
  const { data, loading, error, refetch } = useQuery(GetAgentDetail, {
    variables: { organisationId: organisation?.id, agentId: params.agent },
    skip: !organisation?.id,
    fetchPolicy: 'cache-and-network',
    pollInterval: 15000,
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
  const workflows: Workflow[] = (data?.agentWorkflows || []).filter(Boolean)
  const agentActive = isAgentActive(agent?.status)
  const canUpdate = userHasOrganisationAgentPermission(organisation, 'update')
  const canAllowHosts = canAllowAgentConnectionHost(canUpdate, canManageConnectionHosts)
  const canDelete = userHasOrganisationAgentPermission(organisation, 'delete')
  const canCreateWorkflow =
    canUpdate &&
    !!organisationPermissions &&
    userHasPermission(organisationPermissions, 'AgentWorkflows', 'create')
  const canUpdateWorkflow =
    !!organisationPermissions &&
    userHasPermission(organisationPermissions, 'AgentWorkflows', 'update')
  const canDeleteWorkflow =
    !!organisationPermissions &&
    userHasPermission(organisationPermissions, 'AgentWorkflows', 'delete')
  const canRevokeSession =
    !!organisationPermissions &&
    userHasPermission(organisationPermissions, 'AgentSessions', 'delete')
  const canMintToken =
    !!agent &&
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
      toast.error(errorText(mutationError))
    }
  }

  // Organisation context resolves before the not-found state so a slow
  // session never flashes "Agent not found".
  if (!organisation || (loading && !data)) return <AgentDetailSkeleton />
  if (error) return <AgentError message={error.message} retry={() => refetch()} />
  if (!agent)
    return (
      <AgentEmpty
        title="Agent not found"
        subtitle="This Agent does not exist or has not been assigned to you."
      />
    )

  const harness = agentHarnessMeta(agent.harnessType)
  const HarnessIcon = harness.Icon

  const tabs = [
    { name: 'Workflows', count: workflows.length },
    { name: 'Sessions', count: sessions.length },
    { name: 'Logs', count: canReadLogs ? 'Live' : 0 },
    { name: 'Tokens', count: agent.tokens.length },
    { name: 'Members', count: agent.canManageMembers ? agent.memberships.length : '—' },
  ]

  return (
    <div className="space-y-5">
      <Link
        href={agentsPath(params.team)}
        className="inline-flex items-center gap-2 text-xs text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <FaArrowLeft /> Back to Agents
      </Link>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-xl border border-neutral-500/20 bg-neutral-500/5">
            <HarnessIcon
              role="img"
              aria-label={`${harness.label} harness`}
              className={`size-8 ${harness.iconClass}`}
            />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold truncate">{agent.name}</h2>
              <AgentBadge tone={agentActive ? 'green' : 'red'}>
                {humanizeAgentValue(agent.status)}
              </AgentBadge>
              <AgentBadge>{harness.label}</AgentBadge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
              <span>{activeSessions.length} active sessions</span>
              <span>
                Created by {agent.createdBy?.fullName || agent.createdBy?.email || 'Unknown'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canMintToken && (
            <MintAgentTokenDialog
              agentId={agent.id}
              workflows={workflows.map(({ id, name }) => ({ id, name }))}
              harnessType={agent.harnessType}
            />
          )}
          {canUpdate && (
            <>
              <EditAgentDialog agent={agent} />
              <Button
                variant={agentActive ? 'warning' : 'secondary'}
                icon={agentActive ? FaPause : FaPlay}
                isLoading={updating}
                onClick={toggleStatus}
              >
                {agentActive ? 'Disable' : 'Enable'}
              </Button>
            </>
          )}
          {canDelete && (
            <DeleteAgentDialog
              agentId={agent.id}
              agentName={agent.name}
              onDeleted={() => router.replace(agentsPath(params.team, 'all'))}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['Workflows', workflows.length],
          ['Active sessions', activeSessions.length],
          [
            'Connections granted',
            workflows.reduce((sum, workflow) => sum + workflow.grants.length, 0),
          ],
          ['Assigned members', agent.canManageMembers ? agent.memberships.length : 'Restricted'],
          ['Last seen', formatAgentDate(agent.lastSeenAt)],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-neutral-500/20 p-3">
            <div className="text-2xs uppercase tracking-wider text-neutral-500">{label}</div>
            <div className="mt-1 text-sm font-semibold truncate">{value}</div>
          </div>
        ))}
      </div>

      <Tab.Group selectedIndex={selectedTab} onChange={setSelectedTab}>
        <Tab.List className="flex gap-1 overflow-x-auto border-b border-neutral-500/20">
          {tabs.map((tab) => (
            <Tab as={Fragment} key={tab.name}>
              {({ selected }) => (
                <button
                  className={clsx(
                    'px-3 py-2 text-xs border-b -mb-px whitespace-nowrap outline-none',
                    selected
                      ? 'border-emerald-500 font-semibold'
                      : 'border-transparent text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100'
                  )}
                >
                  {tab.name} <span className="ml-1 text-2xs text-neutral-500">{tab.count}</span>
                </button>
              )}
            </Tab>
          ))}
        </Tab.List>
        <Tab.Panels className="pt-4">
          <Tab.Panel className="space-y-4">
            <div className="flex justify-end">
              {canCreateWorkflow && <CreateWorkflowDialog agentId={agent.id} />}
            </div>
            {workflows.length === 0 ? (
              <AgentEmpty
                title="No workflows"
                subtitle="Every Agent needs at least one active workflow."
              />
            ) : (
              workflows.map((workflow) => (
                <AgentPanel
                  key={workflow.id}
                  title={workflow.name}
                  action={
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <CopyButton
                        value={workflow.id}
                        buttonVariant="ghost"
                        title="Copy Workflow ID"
                      >
                        <span className="font-mono text-2xs text-neutral-500">{workflow.id}</span>
                      </CopyButton>
                      {canUpdateWorkflow && (
                        <>
                          <EditWorkflowDialog workflow={workflow} />
                          {canReadAssets && (
                            <GrantWorkflowDialog
                              workflowId={workflow.id}
                              connections={connections}
                            />
                          )}
                        </>
                      )}
                      {canDeleteWorkflow && workflows.length > 1 && (
                        <ConfirmAgentAction
                          title="Delete workflow"
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
                  }
                >
                  <div className="p-4">
                    {!canReadAssets ? (
                      <div>
                        <h3 className="mb-2 text-xs font-semibold">Granted Connections</h3>
                        <p className="text-xs text-neutral-500">
                          Connection metadata is restricted for your role.
                        </p>
                      </div>
                    ) : !workflow.grants.some(Boolean) ? (
                      <div className="grid overflow-hidden rounded-xl border border-neutral-500/20 md:grid-cols-[minmax(220px,0.75fr)_minmax(0,1.25fr)]">
                        <div className="flex items-start gap-3 bg-neutral-500/5 px-4 py-4">
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            <FaPlug aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-medium">No Connections granted</div>
                            <p className="mt-1 text-xs leading-5 text-neutral-500">
                              This workflow can authenticate, but it cannot use third-party
                              credentials yet.
                            </p>
                          </div>
                        </div>
                        <div className="border-t border-neutral-500/20 bg-zinc-950 px-4 py-3.5 text-zinc-100 md:border-l md:border-t-0">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-xs font-medium">
                              <FaTerminal
                                className="shrink-0 text-emerald-400"
                                aria-hidden="true"
                              />
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
                      </div>
                    ) : (
                      <div>
                        <h3 className="mb-2 text-xs font-semibold">Granted Connections</h3>
                        <div className="space-y-2">
                          {workflow.grants.filter(Boolean).map((grant) => (
                            <div
                              key={grant!.id}
                              className="flex flex-col gap-2 rounded-lg border border-neutral-500/20 p-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <FaPlug className="text-emerald-500" />
                                  <span className="truncate text-sm font-medium">
                                    {grant!.connection.name}
                                  </span>
                                  <AgentBadge>{grant!.connection.serviceType}</AgentBadge>
                                </div>
                                <div className="mt-1 text-xs text-neutral-500">
                                  Integration credentials:{' '}
                                  {grant!.connection.authentication?.name || 'Credentials needed'}
                                  {grant!.connection.authentication?.provider?.name && (
                                    <span> ({grant!.connection.authentication.provider.name})</span>
                                  )}
                                </div>
                                <p className="mt-1.5 text-2xs text-neutral-500">
                                  {humanizeAgentValue(grant!.connection.state)} through the Phase
                                  Agent proxy.
                                </p>
                              </div>
                              {canUpdateWorkflow && (
                                <div className="flex flex-wrap items-center gap-1">
                                  <Link
                                    href={agentsPath(params.team, 'connections')}
                                    className="px-2 text-xs text-emerald-600 dark:text-emerald-400"
                                  >
                                    Manage Connection
                                  </Link>
                                  <ConfirmAgentAction
                                    title="Revoke workflow grant"
                                    description="This Workflow will immediately lose access to this Connection."
                                    actionLabel="Revoke"
                                    onConfirm={async () => {
                                      await revokeGrant({
                                        variables: { grantId: grant!.id },
                                        refetchQueries: ['GetAgentDetail'],
                                        awaitRefetchQueries: true,
                                      })
                                      toast.success('Workflow grant revoked')
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </AgentPanel>
              ))
            )}
          </Tab.Panel>

          <Tab.Panel>
            {sessions.length === 0 ? (
              <AgentEmpty
                title="No sessions"
                subtitle="Sessions appear after an Agent opens a workflow through the Phase CLI."
              />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-neutral-500/20">
                <table className="min-w-full divide-y divide-neutral-500/20 text-xs">
                  <thead className="bg-neutral-500/5 text-left text-2xs uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="px-4 py-3">Session</th>
                      <th className="px-4 py-3">Workflow</th>
                      <th className="px-4 py-3">State</th>
                      <th className="px-4 py-3">Last seen</th>
                      <th className="px-4 py-3">Expires</th>
                      <th className="px-4 py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-500/20">
                    {sessions.map((session) => (
                      <tr key={session.id}>
                        <td className="px-4 py-3">
                          <CopyButton value={session.sessionUid} buttonVariant="ghost">
                            <code>{session.sessionUid.slice(0, 12)}…</code>
                          </CopyButton>
                          <div className="text-2xs text-neutral-500 mt-1">
                            {session.harnessLabel || 'Unlabelled harness'}
                          </div>
                        </td>
                        <td className="px-4 py-3">{session.workflow.name}</td>
                        <td className="px-4 py-3">
                          <AgentBadge tone={isActiveSession(session) ? 'green' : 'neutral'}>
                            {session.revokedAt
                              ? 'Revoked'
                              : isActiveSession(session)
                                ? 'Active'
                                : 'Expired'}
                          </AgentBadge>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-neutral-500">
                          {formatAgentDate(session.lastSeenAt)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-neutral-500">
                          {formatAgentDate(session.expiresAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canRevokeSession && isActiveSession(session) && (
                            <ConfirmAgentAction
                              title="Revoke Agent session"
                              description="The session key will stop working immediately."
                              actionLabel="Revoke"
                              onConfirm={async () => {
                                await revokeSession({
                                  variables: { sessionUid: session.sessionUid },
                                  refetchQueries: ['GetAgentDetail'],
                                  awaitRefetchQueries: true,
                                })
                                toast.success('Session revoked')
                              }}
                            />
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
              agentName={agent.name}
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
                  })),
              }))}
              sessions={sessions.map(({ sessionUid, workflow }) => ({ sessionUid, workflow }))}
              canRead={canReadLogs}
              canAllowHosts={canAllowHosts}
            />
          </Tab.Panel>

          <Tab.Panel>
            {!canReadTokens ? (
              <AgentEmpty
                title="Access restricted"
                subtitle="You do not have permission to view Agent token metadata."
              />
            ) : agent.tokens.length === 0 ? (
              <AgentEmpty
                title="No Agent tokens"
                subtitle="Generate a scoped Agent token for an agent-only CLI login."
              />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-neutral-500/20">
                <table className="min-w-full divide-y divide-neutral-500/20 text-xs">
                  <thead className="bg-neutral-500/5 text-left text-2xs uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="px-4 py-3">Token</th>
                      <th className="px-4 py-3">Workflow</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3">Last used</th>
                      <th className="px-4 py-3">Expires</th>
                      <th className="px-4 py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-500/20">
                    {agent.tokens.map((token: any) => (
                      <tr key={token.id}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{token.name}</div>
                          <div className="font-mono text-2xs text-neutral-500">{token.id}</div>
                        </td>
                        <td className="px-4 py-3">{token.workflow.name}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-neutral-500">
                          {formatAgentDate(token.createdAt)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-neutral-500">
                          {formatAgentDate(token.lastUsedAt)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-neutral-500">
                          {formatAgentDate(token.expiresAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canRevokeToken && (
                            <ConfirmAgentAction
                              title="Revoke Agent token"
                              description="The token and every active session opened with it will stop working immediately."
                              actionLabel="Revoke"
                              onConfirm={async () => {
                                await revokeToken({
                                  variables: { tokenId: token.id },
                                  refetchQueries: ['GetAgentDetail'],
                                  awaitRefetchQueries: true,
                                })
                                toast.success('Agent token revoked')
                              }}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-neutral-500/5 p-3 text-xs text-neutral-500">
              <FaTerminal className="mt-0.5 shrink-0" />
              <span>
                Agent tokens are endpoint scoped. Token values are reveal once and never available
                from this page.
              </span>
            </div>
          </Tab.Panel>

          <Tab.Panel>
            <AgentMembers
              organisationId={organisation.id}
              agentId={agent.id}
              workflows={workflows.map(({ id, name }) => ({ id, name }))}
              createdBy={agent.createdBy}
              canManageMembers={agent.canManageMembers}
            />
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  )
}
