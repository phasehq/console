'use client'

import {
  CreateConnectionDialog,
  UpdateConnectionDialog,
} from '@/components/agents/AgentConnectionDialogs'
import { useContext, useMemo, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { useMutation, useQuery } from '@apollo/client'
import {
  FaCheck,
  FaCheckCircle,
  FaChevronRight,
  FaExclamationTriangle,
  FaKey,
  FaSearch,
  FaTimesCircle,
  FaTrashAlt,
} from 'react-icons/fa'
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
import { ConnectionPolicyBlocks, PolicySummary } from '@/components/agents/AgentAccessPolicy'
import {
  AgentAccessDenied,
  AgentBadge,
  AgentEmpty,
  AgentError,
  AgentPageHeader,
  agentPrimaryAction,
  AgentSearchSkeleton,
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
import {
  CustomConnectionSummary,
  EditCustomConnectionDialog,
} from '@/components/agents/CustomConnectionDialogs'
import {
  describeHttpHost,
  httpPresetLabel,
  isCustomConnection,
  parseHttpDefinition,
} from '@/utils/agents/httpDefinition'

const HEAD = 'text-left text-xs font-medium uppercase tracking-wider text-gray-500'
const COLUMN_COUNT = 5

/** One labelled value in an expanded row, in the style of the Agent log's details. */
const DetailField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0 space-y-0.5">
    <div className="text-2xs font-medium uppercase tracking-wider text-neutral-500">{label}</div>
    <div className="text-xs font-medium">{children}</div>
  </div>
)

/** The hosts a Connection reaches, as they are shown and searched. */
const connectionHosts = (connection: any): string[] =>
  isCustomConnection(connection.serviceType)
    ? (parseHttpDefinition(connection.definition ?? connection.config)?.hosts ?? []).map(
        describeHttpHost
      )
    : configuredAgentHostRules(connection.config)
        .map((rule: unknown) => presentAgentHostRule(rule)?.endpoint)
        .filter((endpoint): endpoint is string => !!endpoint)

export default function AgentConnectionsPage() {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const [search, setSearch] = useState('')
  // Rows start collapsed; these are the ones open.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set())
  const canRead =
    !!organisation && userHasPermission(organisation.role?.permissions, 'AgentConnections', 'read')
  // A packaged service also needs integration credentials; the dialog says so.
  // A custom HTTP Connection does not, so creating is not gated on them.
  const canCreate =
    !!organisation &&
    userHasPermission(organisation.role?.permissions, 'AgentConnections', 'create')
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
  const connections: any[] = useMemo(
    () => (data?.agentConnections || []).filter(Boolean),
    [data?.agentConnections]
  )
  const services = (data?.agentServiceTemplates || []).filter(Boolean)
  // By name, service and host.
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return connections
    return connections.filter((connection) =>
      [
        connection.name,
        connection.serviceType,
        agentServiceMeta(connection.serviceType).label,
        ...connectionHosts(connection),
      ].some((text) => String(text).toLowerCase().includes(query))
    )
  }, [connections, search])
  const toggleRow = (id: string) =>
    setExpandedRows((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
      <>
        <AgentSearchSkeleton />
        <div className={clsx(agentCardSurface(), 'px-4')}>
          <AgentTableSkeleton />
        </div>
      </>
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
        <>
          <div className="relative flex w-full max-w-sm items-center rounded-md bg-zinc-100 px-2 dark:bg-zinc-800">
            <FaSearch className="text-neutral-500" />
            <input
              aria-label="Search Connections"
              placeholder="Search Connections, services or hosts"
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
            <AgentEmpty
              title="No matching Connections"
              subtitle="Try a different Connection, service or host."
            />
          ) : (
            <div className={clsx(agentCardSurface(), 'overflow-x-auto')}>
              <table className="min-w-full table-auto text-sm">
                <thead className="border-b border-zinc-500/40">
                  <tr>
                    <th className="w-6 py-3"></th>
                    <th className={`px-4 py-3 ${HEAD}`}>Connection</th>
                    <th className={`px-4 py-3 ${HEAD}`}>Service</th>
                    <th className={`px-4 py-3 ${HEAD}`}>Host or credential</th>
                    <th className="px-4 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                {filtered.map((connection: any) => {
                  // A custom Connection carries its own definition and sealed secret.
                  const custom = isCustomConnection(connection.serviceType)
                  const definition = custom
                    ? parseHttpDefinition(connection.definition ?? connection.config)
                    : null
                  const showHostOverride =
                    !custom &&
                    agentHostRulesRequireIndependentReview(
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
                  const reviewPending = showHostOverride && !hostOverrideApproved
                  const authorId = connection.hostRulesAuthoredBy?.id
                  // A second member must approve: the author only sees that it waits.
                  const viewerAuthoredHosts = !!authorId && authorId === organisation?.memberId
                  const hosts = connectionHosts(connection)
                  const credential = connection.authentication
                  const active = connection.state?.toLowerCase() === 'active'
                  const version = String(connection.hostRulesVersion).slice(0, 8)
                  const expanded = expandedRows.has(connection.id)
                  const detailsId = `connection-${connection.id}-details`

                  return (
                    // One body per Connection, so its details hover with it.
                    <tbody key={connection.id} data-connection-row className="group">
                      <tr
                        className={clsx(
                          'cursor-pointer border-neutral-500/20 transition duration-300 ease-in-out',
                          expanded
                            ? 'border-r bg-neutral-100 dark:bg-neutral-800'
                            : 'border-b hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        )}
                        onClick={() => toggleRow(connection.id)}
                      >
                        <td
                          className={clsx(
                            'border-l px-2 py-2',
                            expanded ? 'border-l-emerald-500' : 'border-l-transparent'
                          )}
                        >
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={detailsId}
                            aria-label={`${expanded ? 'Hide' : 'Show'} details for ${connection.name}`}
                            className="flex rounded p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                            onClick={(clickEvent) => {
                              clickEvent.stopPropagation()
                              toggleRow(connection.id)
                            }}
                          >
                            <FaChevronRight
                              className={clsx(
                                'transform text-xs transition-all duration-300',
                                expanded && 'rotate-90 text-emerald-500'
                              )}
                            />
                          </button>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex min-w-0 items-center gap-3">
                            <AgentServiceTile serviceType={connection.serviceType} />
                            <h3 className="max-w-[16rem] truncate font-medium leading-tight">
                              {connection.name}
                            </h3>
                            {/* "Credentials needed" already says why a Connection is pending. */}
                            {!active && credential && (
                              <AgentBadge tone="amber">
                                {humanizeAgentValue(connection.state || 'pending_credentials')}
                              </AgentBadge>
                            )}
                            {reviewPending && <AgentBadge tone="amber">Needs review</AgentBadge>}
                            {connection.takesPolicy && <PolicySummary policy={connection.policy} />}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-neutral-500">
                          {agentServiceMeta(connection.serviceType).label}
                        </td>
                        <td className="px-4 py-2">
                          {custom ? (
                            hosts.length ? (
                              <span className="flex min-w-0 items-center gap-1.5">
                                <code className="max-w-[16rem] truncate text-xs font-medium">
                                  {hosts[0]}
                                </code>
                                {hosts.length > 1 && (
                                  <span className="whitespace-nowrap text-2xs text-neutral-500">
                                    +{hosts.length - 1} more
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-neutral-500">Unreadable definition</span>
                            )
                          ) : credential ? (
                            <span className="flex min-w-0 items-center gap-1.5 font-medium">
                              <FaKey aria-hidden="true" className="shrink-0 text-neutral-500" />
                              <span className="max-w-[16rem] truncate">{credential.name}</span>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                              <FaKey aria-hidden="true" className="shrink-0" />
                              Credentials needed
                            </span>
                          )}
                        </td>
                        {/* Stops row toggles, including clicks in the portalled dialogs. */}
                        <td
                          className="px-4 py-2"
                          onClick={(clickEvent) => clickEvent.stopPropagation()}
                        >
                          {/* On row hover, like the other Agent lists. */}
                          <div
                            className={clsx(
                              'flex items-center justify-end gap-1',
                              agentRowActions.row
                            )}
                          >
                            {canUpdate && custom && (
                              <EditCustomConnectionDialog
                                connection={connection}
                                onOpen={() => refetch()}
                              />
                            )}
                            {canUpdate && !custom && (
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
                      {expanded && (
                        <tr>
                          <td
                            colSpan={COLUMN_COUNT}
                            className="border-b border-l border-r border-neutral-500/20 border-l-emerald-500"
                          >
                            <div
                              id={detailsId}
                              className="w-full space-y-4 bg-neutral-100 p-4 shadow-xl dark:bg-neutral-800"
                            >
                              {custom && definition && (
                                <CustomConnectionSummary definition={definition} />
                              )}
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                {custom ? (
                                  <>
                                    <DetailField label="Secret">
                                      Sealed secret · {httpPresetLabel(definition?.preset)}
                                    </DetailField>
                                    <DetailField label="Value updated">
                                      <AgentTime
                                        value={connection.valueUpdatedAt}
                                        fallback="never"
                                      />
                                      {(connection.valueUpdatedBy?.fullName ||
                                        connection.valueUpdatedBy?.email) &&
                                        ` by ${
                                          connection.valueUpdatedBy.fullName ||
                                          connection.valueUpdatedBy.email
                                        }`}
                                    </DetailField>
                                  </>
                                ) : (
                                  <>
                                    <DetailField label="Integration credentials">
                                      {!credential ? (
                                        <span className="text-amber-700 dark:text-amber-400">
                                          Credentials needed
                                        </span>
                                      ) : canReadCredentials ? (
                                        <Link
                                          href={integrationCredentialHref(
                                            organisation.name,
                                            credential
                                          )}
                                          title={`View credential ${credential.name}`}
                                          className="hover:text-emerald-500"
                                        >
                                          {credential.name}
                                        </Link>
                                      ) : (
                                        credential.name
                                      )}
                                      {credential?.provider?.name && (
                                        <span className="font-normal text-neutral-500">
                                          {' '}
                                          · {credential.provider.name}
                                        </span>
                                      )}
                                    </DetailField>
                                    <DetailField label="Endpoint">
                                      {(showHostOverride || showEndpointDetails) && hosts.length ? (
                                        <>
                                          {hosts.map((endpoint) => (
                                            <code key={endpoint} className="block break-all">
                                              {endpoint}
                                            </code>
                                          ))}
                                          <span
                                            className={clsx(
                                              'mt-0.5 flex items-center gap-1 text-2xs font-normal',
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
                                              <FaCheckCircle
                                                aria-hidden="true"
                                                className="shrink-0"
                                              />
                                            )}
                                            {showHostOverride
                                              ? hostOverrideApproved
                                                ? 'Approved override'
                                                : 'Custom host override'
                                              : 'Configured endpoint'}
                                          </span>
                                        </>
                                      ) : (
                                        <span className="font-normal text-neutral-500">
                                          {hosts.length ? 'Configured endpoint' : 'Built-in hosts'}
                                        </span>
                                      )}
                                    </DetailField>
                                  </>
                                )}
                                <DetailField label="Updated">
                                  <AgentTime value={connection.updatedAt} />
                                </DetailField>
                              </div>
                              <ConnectionPolicyBlocks connection={connection} canEdit={canUpdate} />
                              {reviewPending && (
                                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-1.5">
                                  <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                                    <FaExclamationTriangle
                                      aria-hidden="true"
                                      className="shrink-0"
                                    />
                                    {viewerAuthoredHosts
                                      ? 'Waiting for another authorized member to approve'
                                      : 'Needs independent review'}
                                    <code className="font-normal text-neutral-500">
                                      Version {version}
                                    </code>
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
                                          toastUnhandledError(
                                            approvalError,
                                            'Host-rule approval failed'
                                          )
                                        }
                                      }}
                                    >
                                      Approve reviewed version
                                    </Button>
                                  )}
                                </div>
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
        </>
      )}
    </div>
  )
}
