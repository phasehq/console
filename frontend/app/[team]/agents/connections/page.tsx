'use client'

import {
  CreateConnectionDialog,
  UpdateConnectionDialog,
} from '@/components/agents/AgentConnectionDialogs'
import { useContext } from 'react'
import clsx from 'clsx'
import { useMutation, useQuery } from '@apollo/client'
import { FaCheck, FaCheckCircle, FaExclamationTriangle } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { toastUnhandledError } from '@/utils/errors'
import { GetAgentAssets } from '@/graphql/queries/agents/getAgentAssets.gql'
import {
  ApproveAgentConnectionHostRulesOp,
  DeleteAgentConnectionOp,
} from '@/graphql/mutations/agents/manageAgentAssets.gql'
import { Button } from '@/components/common/Button'
import { ConfirmAgentAction } from '@/components/agents/AgentDialogs'
import {
  AgentAccessDenied,
  AgentBadge,
  AgentCardGridSkeleton,
  AgentEmpty,
  AgentError,
  AgentPageHeader,
  agentPrimaryAction,
  AgentTime,
  agentCardSurface,
  humanizeAgentValue,
} from '@/components/agents/AgentUI'
import {
  agentHostRulesRequireIndependentReview,
  configuredAgentDatabase,
  configuredAgentHostRules,
  presentAgentHostRule,
  showAgentConnectionEndpointDetails,
  type AgentHostRulesMode,
} from '@/components/agents/AgentConnectionHostRules'
import { AgentServiceTile } from '@/components/agents/AgentBrandIcons'
import { AgentConnectionCredentialCard } from '@/components/agents/AgentConnectionCredentialCard'

export default function AgentConnectionsPage() {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const canRead =
    !!organisation && userHasPermission(organisation.role?.permissions, 'AgentConnections', 'read')
  const canCreate =
    !!organisation &&
    userHasPermission(organisation.role?.permissions, 'AgentConnections', 'create') &&
    userHasPermission(organisation.role?.permissions, 'IntegrationCredentials', 'read')
  const canReadCredentials =
    !!organisation &&
    userHasPermission(organisation.role?.permissions, 'IntegrationCredentials', 'read')
  const canDelete =
    !!organisation &&
    userHasPermission(organisation.role?.permissions, 'AgentConnections', 'delete')
  const canUpdate =
    !!organisation &&
    userHasPermission(organisation.role?.permissions, 'AgentConnections', 'update')
  const { data, loading, error, refetch } = useQuery(GetAgentAssets, {
    variables: {
      organisationId: organisation?.id,
      includeConnections: true,
      includeServiceTemplates: true,
    },
    skip: !organisation?.id || !canRead,
    fetchPolicy: 'cache-and-network',
  })
  const [remove] = useMutation(DeleteAgentConnectionOp)
  const [approveHostRules, { loading: approving }] = useMutation(ApproveAgentConnectionHostRulesOp)
  const connections = (data?.agentConnections || []).filter(Boolean)
  const services = (data?.agentServiceTemplates || []).filter(Boolean)
  const hostRulesModeFor = (serviceType: string): AgentHostRulesMode | undefined =>
    services.find((service: any) => service.serviceType.toLowerCase() === serviceType.toLowerCase())
      ?.hostRulesMode

  const createConnection =
    canCreate && organisation?.id ? (
      <CreateConnectionDialog organisationId={organisation.id} services={services} />
    ) : undefined
  // Top-right once Connections exist, centred in the empty state until then.
  const create = agentPrimaryAction(createConnection, connections.length > 0)

  const header = (
    <AgentPageHeader
      title="Connections"
      description="Connect Workflows to third-party integration credentials through the Agent proxy."
      action={create.header}
    />
  )
  const section = (children: React.ReactNode) => (
    <div className="space-y-5">
      {header}
      {children}
    </div>
  )

  // Organisation context resolves before any permission or data check so the
  // page never flashes restricted or empty while the session is still loading.
  if (!organisation || (canRead && loading && !data)) return section(<AgentCardGridSkeleton />)
  if (!canRead)
    return section(
      <AgentAccessDenied subtitle="You do not have permission to view Agent Connections." />
    )
  if (error && !data) return section(<AgentError message={error.message} retry={() => refetch()} />)
  return (
    <div className="space-y-5">
      {header}
      {connections.length === 0 ? (
        <AgentEmpty
          title="No Connections yet"
          subtitle="Connect a Workflow to a trusted service endpoint to get started."
        >
          {create.empty ?? <></>}
        </AgentEmpty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {connections.map((connection: any) => {
            const showHostOverride = agentHostRulesRequireIndependentReview(
              hostRulesModeFor(connection.serviceType),
              connection.config
            )
            const showEndpointDetails = showAgentConnectionEndpointDetails(
              connection.serviceType,
              connection.config
            )
            const hostOverrideApproved =
              !!connection.hostRulesApprovedBy &&
              connection.hostRulesApprovedVersion === connection.hostRulesVersion
            const authorId = connection.hostRulesAuthoredBy?.id
            // A second member must approve: the author only sees that it waits.
            const viewerAuthoredHosts = !!authorId && authorId === organisation?.memberId

            return (
              <article key={connection.id} className={clsx(agentCardSurface(), 'p-4')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <AgentServiceTile serviceType={connection.serviceType} />
                    <div className="min-w-0">
                      <h3 className="font-semibold truncate">{connection.name}</h3>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <AgentBadge
                          tone={connection.state?.toLowerCase() === 'active' ? 'green' : 'amber'}
                        >
                          {humanizeAgentValue(connection.state || 'pending_credentials')}
                        </AgentBadge>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    {canUpdate && (
                      <UpdateConnectionDialog
                        connection={connection}
                        services={services}
                        onDone={() => refetch()}
                      />
                    )}
                    {canDelete && (
                      <ConfirmAgentAction
                        title="Delete Connection"
                        description="Active Workflow grants for this Connection will also be revoked."
                        actionLabel="Delete"
                        onConfirm={async () => {
                          await remove({
                            variables: { connectionId: connection.id },
                            refetchQueries: ['GetAgentAssets', 'GetAgentDetail'],
                            awaitRefetchQueries: true,
                          })
                          toast.success('Connection deleted')
                        }}
                      />
                    )}
                  </div>
                </div>
                <AgentConnectionCredentialCard
                  credential={connection.authentication}
                  team={organisation.name}
                  canView={canReadCredentials}
                />
                {/* Any host override that needs review shows here, so its review row
                    never drops out with the endpoint details. */}
                {(showEndpointDetails || showHostOverride) && (
                  <div className="mt-3 rounded-lg border border-neutral-500/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium">
                        {showHostOverride ? 'Custom host override' : 'Connection endpoint'}
                      </span>
                      {showHostOverride && (
                        <code className="text-2xs text-neutral-500">
                          Version {String(connection.hostRulesVersion).slice(0, 8)}
                        </code>
                      )}
                    </div>
                    <ul className="mt-2 space-y-2">
                      {configuredAgentHostRules(connection.config).map(
                        (rule: unknown, index: number) => {
                          const presentation = presentAgentHostRule(rule)
                          if (!presentation) return null

                          return (
                            <li
                              key={`${presentation.endpoint}-${index}`}
                              className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-neutral-500/5 px-3 py-2"
                            >
                              <span className="shrink-0 text-2xs text-neutral-500">
                                {presentation.matchLabel}
                              </span>
                              <code className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                                {presentation.endpoint}
                              </code>
                            </li>
                          )
                        }
                      )}
                      {configuredAgentDatabase(connection.config) && (
                        <li className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-neutral-500/5 px-3 py-2">
                          <span className="shrink-0 text-2xs text-neutral-500">Database</span>
                          <code className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                            {configuredAgentDatabase(connection.config)}
                          </code>
                        </li>
                      )}
                    </ul>
                    {!showHostOverride && (
                      <p className="mt-2 text-2xs text-neutral-500">
                        Derived from the selected integration credentials.
                      </p>
                    )}
                    {showHostOverride && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-500/20 pt-3">
                        {hostOverrideApproved ? (
                          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            <FaCheckCircle aria-hidden="true" className="shrink-0" />
                            Approved for this exact version
                          </p>
                        ) : (
                          <>
                            <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                              <FaExclamationTriangle aria-hidden="true" className="shrink-0" />
                              {viewerAuthoredHosts
                                ? 'Waiting for another authorized member to approve'
                                : 'Needs independent review'}
                            </p>
                            {canUpdate && authorId && !viewerAuthoredHosts && (
                              <Button
                                type="button"
                                variant="primary"
                                icon={FaCheck}
                                isLoading={approving}
                                onClick={async () => {
                                  try {
                                    await approveHostRules({
                                      variables: {
                                        connectionId: connection.id,
                                        expectedVersion: connection.hostRulesVersion,
                                      },
                                      refetchQueries: ['GetAgentAssets', 'GetAgentDetail'],
                                      awaitRefetchQueries: true,
                                    })
                                    toast.success('Custom host override approved')
                                  } catch (approvalError) {
                                    toastUnhandledError(approvalError, 'Host-rule approval failed')
                                  }
                                }}
                              >
                                Approve reviewed version
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-neutral-500">Updated</dt>
                    <dd className="mt-0.5">
                      <AgentTime value={connection.updatedAt} />
                    </dd>
                  </div>
                  {!showHostOverride && (
                    <div>
                      <dt className="text-neutral-500">Endpoint</dt>
                      <dd className="mt-1">
                        {configuredAgentHostRules(connection.config).length ? (
                          <AgentBadge tone="green">Configured endpoint</AgentBadge>
                        ) : (
                          <AgentBadge>Built-in hosts</AgentBadge>
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
