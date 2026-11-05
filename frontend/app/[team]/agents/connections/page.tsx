'use client'

import {
  CreateConnectionDialog,
  UpdateConnectionDialog,
} from '@/components/agents/AgentConnectionDialogs'
import { useContext } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { useMutation, useQuery } from '@apollo/client'
import { FaCheck, FaCheckCircle, FaExclamationTriangle, FaKey, FaTrashAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { toastUnhandledError } from '@/utils/errors'
import { integrationCredentialHref } from '@/utils/integrationCredentials'
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
  AgentEmpty,
  AgentError,
  AgentPageHeader,
  agentPrimaryAction,
  AgentTableSkeleton,
  AgentTime,
  agentCardSurface,
  humanizeAgentValue,
  agentRowActions,
} from '@/components/agents/AgentUI'
import {
  agentHostRulesRequireIndependentReview,
  configuredAgentHostRules,
  presentAgentHostRule,
  showAgentConnectionEndpointDetails,
  type AgentHostRulesMode,
} from '@/components/agents/AgentConnectionHostRules'
import { AgentServiceTile, agentServiceMeta } from '@/components/agents/AgentBrandIcons'

const HEAD = 'text-left text-xs font-medium uppercase tracking-wider text-gray-500'

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
  if (!organisation || (canRead && loading && !data))
    return section(
      <div className={clsx(agentCardSurface(), 'px-4')}>
        <AgentTableSkeleton />
      </div>
    )
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
        <div className={clsx(agentCardSurface(), 'overflow-x-auto px-4')}>
          <table className="min-w-full table-auto divide-y divide-zinc-500/20 text-sm">
            <thead className="border-b border-zinc-500/40">
              <tr>
                <th className={`py-3 ${HEAD}`}>Connection</th>
                <th className={`px-4 py-3 ${HEAD}`}>Integration credentials</th>
                <th className={`px-4 py-3 ${HEAD}`}>Endpoint</th>
                <th className={`px-4 py-3 ${HEAD}`}>Updated</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
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
              const hosts = configuredAgentHostRules(connection.config)
                .map((rule: unknown) => presentAgentHostRule(rule))
                .filter(Boolean) as Array<{ endpoint: string }>
              const credential = connection.authentication
              const active = connection.state?.toLowerCase() === 'active'
              const version = String(connection.hostRulesVersion).slice(0, 8)

              return (
                // One body per Connection, so its review row hovers with it.
                <tbody key={connection.id} data-connection-row className="group">
                  <tr>
                    <td className="py-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <AgentServiceTile serviceType={connection.serviceType} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="max-w-[16rem] truncate font-medium leading-tight">
                              {connection.name}
                            </h3>
                            {/* "Credentials needed" already says why a Connection is pending. */}
                            {!active && credential && (
                              <AgentBadge tone="amber">
                                {humanizeAgentValue(connection.state || 'pending_credentials')}
                              </AgentBadge>
                            )}
                          </div>
                          <div className="mt-1 text-2xs leading-4 text-neutral-500">
                            {agentServiceMeta(connection.serviceType).label}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {credential ? (
                        <>
                          {canReadCredentials ? (
                            <Link
                              href={integrationCredentialHref(organisation.name, credential)}
                              title={`View credential ${credential.name}`}
                              className="flex min-w-0 items-center gap-1.5 font-medium leading-tight hover:text-emerald-500"
                            >
                              <FaKey aria-hidden="true" className="shrink-0 text-neutral-500" />
                              <span className="max-w-[14rem] truncate">{credential.name}</span>
                            </Link>
                          ) : (
                            <span className="flex min-w-0 items-center gap-1.5 font-medium leading-tight">
                              <FaKey aria-hidden="true" className="shrink-0 text-neutral-500" />
                              <span className="max-w-[14rem] truncate">{credential.name}</span>
                            </span>
                          )}
                          {credential.provider?.name && (
                            <div className="mt-1 pl-5 text-2xs leading-4 text-neutral-500">
                              {credential.provider.name}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                          <FaKey aria-hidden="true" className="shrink-0" />
                          Credentials needed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {(showHostOverride || showEndpointDetails) && hosts.length ? (
                        <>
                          <code className="block max-w-[14rem] truncate text-xs font-medium leading-tight">
                            {hosts[0].endpoint}
                          </code>
                          <div
                            className={clsx(
                              'mt-1 flex items-center gap-1 text-2xs leading-4',
                              !showHostOverride
                                ? 'text-neutral-500'
                                : hostOverrideApproved
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-amber-700 dark:text-amber-400'
                            )}
                            title={
                              showHostOverride
                                ? `Version ${version}`
                                : 'Derived from the selected integration credentials.'
                            }
                          >
                            {showHostOverride && hostOverrideApproved && (
                              <FaCheckCircle aria-hidden="true" className="shrink-0" />
                            )}
                            {showHostOverride
                              ? hostOverrideApproved
                                ? 'Approved override'
                                : 'Custom host override'
                              : 'Configured endpoint'}
                            {hosts.length > 1 && ` · +${hosts.length - 1} more`}
                          </div>
                        </>
                      ) : (
                        <span className="text-neutral-500">
                          {hosts.length ? 'Configured endpoint' : 'Built-in hosts'}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-neutral-500">
                      <AgentTime value={connection.updatedAt} />
                    </td>
                    <td className="px-4 py-2">
                      {/* On row hover, like the other Agent lists. */}
                      <div
                        className={clsx('flex items-center justify-end gap-1', agentRowActions.row)}
                      >
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
                            triggerVariant="danger"
                            triggerProps={{ icon: FaTrashAlt }}
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
                    </td>
                  </tr>
                  {showHostOverride && !hostOverrideApproved && (
                    <tr>
                      <td colSpan={5} className="pb-2 pl-12">
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-1.5">
                          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                            <FaExclamationTriangle aria-hidden="true" className="shrink-0" />
                            {viewerAuthoredHosts
                              ? 'Waiting for another authorized member to approve'
                              : 'Needs independent review'}
                            <code className="font-normal text-neutral-500">Version {version}</code>
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
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              )
            })}
          </table>
        </div>
      )}
    </div>
  )
}
