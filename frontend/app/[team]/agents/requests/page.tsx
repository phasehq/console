'use client'

import { use, useContext, useEffect, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import clsx from 'clsx'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { FaChevronRight, FaKey, FaSync, FaSyncAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { userHasOrganisationAgentPermission } from '@/utils/access/agents'
import { agentsPath } from '@/utils/agents/routes'
import { GetAgentRequests } from '@/graphql/queries/agents/getAgentRequests.gql'
import { ResolveAgentRequestOp } from '@/graphql/mutations/agents/manageAgentAssets.gql'
import { ConfirmAgentAction } from '@/components/agents/AgentDialogs'
import { AgentSetupRequestDialog } from '@/components/agents/AgentSetupRequestDialog'
import { HardenedRequestMarkdown } from '@/components/agents/HardenedRequestMarkdown'
import { AgentRequestStatusFilter } from '@/components/agents/AgentRequestStatusFilter'
import { isAgentRequestPending, normalizeAgentEnum } from '@/components/agents/AgentEnums'
import { agentHarnessMeta } from '@/components/agents/AgentBrandIcons'
import {
  agentRequestAnchorId,
  isAgentRequestFulfillmentDeepLink,
  prioritiseAgentRequest,
} from '@/components/agents/AgentRequestDeepLink'
import { Button } from '@/components/common/Button'
import {
  AgentAccessDenied,
  AgentBadge,
  AgentEmpty,
  AgentError,
  AgentPageHeader,
  AgentRequestsSkeleton,
  formatAgentDate,
  humanizeAgentValue,
} from '@/components/agents/AgentUI'

const requestStatusTone = (status: string) => {
  switch (normalizeAgentEnum(status)) {
    case 'PENDING':
      return 'amber' as const
    case 'APPROVED':
      return 'green' as const
    case 'DENIED':
      return 'red' as const
    default:
      return 'neutral' as const
  }
}

const requestKindLabel = (kind: string) =>
  normalizeAgentEnum(kind) === 'CREDENTIAL_UPDATE' ? 'Credential update' : 'Connection setup'

export default function AgentRequestsPage(props: { params: Promise<{ team: string }> }) {
  const params = use(props.params)
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const searchParams = useSearchParams()
  const requestedRequestId = searchParams?.get('request')?.trim() || ''
  const requestedAction = searchParams?.get('action')?.trim().toLowerCase() || ''
  const [status, setStatus] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const permissions = organisation?.role?.permissions
  const canRead = !!permissions && userHasPermission(permissions, 'AgentRequests', 'read')
  const canResolve = !!permissions && userHasPermission(permissions, 'AgentRequests', 'update')
  const canReadCredentials =
    !!permissions && userHasPermission(permissions, 'IntegrationCredentials', 'read')
  const canCreateCredentials =
    !!permissions && userHasPermission(permissions, 'IntegrationCredentials', 'create')
  const { data, loading, error, refetch } = useQuery(GetAgentRequests, {
    variables: {
      organisationId: organisation?.id,
      status: status || null,
    },
    skip: !organisation?.id || !canRead,
    fetchPolicy: 'cache-and-network',
    pollInterval: 10000,
  })
  const [resolveRequest] = useMutation(ResolveAgentRequestOp)
  const requests = prioritiseAgentRequest(
    (data?.agentRequests || []).filter(Boolean),
    requestedRequestId
  )

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refetch()
    } catch {
      toast.error('Unable to refresh Agent requests')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (!requestedRequestId || loading) return
    const frame = window.requestAnimationFrame(() => {
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      document.getElementById(agentRequestAnchorId(requestedRequestId))?.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'center',
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [loading, requestedRequestId, requests.length])

  // Agents raise their own requests, so this section has no create action.
  // Refresh and the status filter are only useful once there is something to
  // act on, or a filter to clear.
  const hasControls = requests.length > 0 || !!status
  const header = (
    <AgentPageHeader
      title="Agent requests"
      description="Review connection setup and credential updates proposed by your Agents."
      action={
        hasControls ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              title={refreshing ? 'Refreshing requests' : 'Refresh requests'}
              icon={FaSync}
              isLoading={refreshing}
              onClick={() => void handleRefresh()}
            >
              Refresh
            </Button>
            <AgentRequestStatusFilter value={status} onChange={setStatus} />
          </div>
        ) : undefined
      }
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
  if (!organisation || (canRead && loading && !data)) return section(<AgentRequestsSkeleton />)
  if (!canRead)
    return section(
      <AgentAccessDenied subtitle="You do not have permission to review Agent requests." />
    )
  if (error) return section(<AgentError message={error.message} retry={() => refetch()} />)

  return (
    <div className="space-y-5">
      {header}

      {requests.length === 0 ? (
        <AgentEmpty
          title="No Agent requests"
          subtitle={
            status
              ? `No ${status} requests match this filter.`
              : 'Connection and credential requests from Agent workflows will appear here.'
          }
        />
      ) : (
        <div className="max-w-4xl space-y-3">
          {requests.map((request: any) => {
            const requestKind = normalizeAgentEnum(request.kind)
            const requestStatus = normalizeAgentEnum(request.status)
            const isUpdate = requestKind === 'CREDENTIAL_UPDATE'
            const isLinked = request.id === requestedRequestId
            const canManageAgent = userHasOrganisationAgentPermission(organisation, 'update')
            const canManageWorkflow =
              !!permissions && userHasPermission(permissions, 'AgentWorkflows', 'update')
            const canFulfill =
              canResolve && canReadCredentials && canManageAgent && canManageWorkflow
            const harness = agentHarnessMeta(request.agent.harnessType || 'other')
            const HarnessIcon = harness.Icon
            const provider = request.credentialProvider || request.serviceType

            return (
              <article
                key={request.id}
                id={agentRequestAnchorId(request.id)}
                className={clsx(
                  'scroll-mt-28 overflow-hidden rounded-xl border bg-neutral-500/[0.02]',
                  isLinked
                    ? 'border-emerald-500/50 ring-2 ring-emerald-500/10'
                    : 'border-neutral-500/20'
                )}
              >
                <div className="flex flex-col gap-3 border-b border-neutral-500/20 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-neutral-500/10">
                      <HarnessIcon className={harness.iconClass} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">{requestKindLabel(requestKind)}</h2>
                        <AgentBadge tone={requestStatusTone(requestStatus)}>
                          {humanizeAgentValue(requestStatus)}
                        </AgentBadge>
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-neutral-500">
                        <Link
                          href={agentsPath(params.team, request.agent.id)}
                          className="font-medium text-zinc-700 hover:text-emerald-500 dark:text-zinc-300"
                        >
                          {request.agent.name}
                        </Link>
                        <FaChevronRight className="size-2" aria-hidden="true" />
                        <Link
                          href={`${agentsPath(params.team, request.agent.id)}?tab=workflows`}
                          className="hover:text-emerald-500"
                        >
                          {request.workflow.name}
                        </Link>
                        {request.connection && (
                          <>
                            <FaChevronRight className="size-2" aria-hidden="true" />
                            <Link
                              href={agentsPath(params.team, 'connections')}
                              className="hover:text-emerald-500"
                            >
                              {request.connection.name}
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  {isAgentRequestPending(requestStatus) &&
                    canResolve &&
                    canManageAgent &&
                    canManageWorkflow && (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {canFulfill && (
                          <AgentSetupRequestDialog
                            organisationId={organisation.id}
                            request={request}
                            canCreateCredentials={canCreateCredentials}
                            autoOpen={isAgentRequestFulfillmentDeepLink(
                              requestedRequestId,
                              requestedAction,
                              request.id
                            )}
                            onDone={() => void refetch()}
                          />
                        )}
                        <ConfirmAgentAction
                          title="Deny Agent request"
                          description="The Agent will receive a denied result and can propose another path."
                          actionLabel="Deny"
                          onConfirm={async () => {
                            await resolveRequest({
                              variables: {
                                requestId: request.id,
                                expectedRevision: request.revision,
                                approved: false,
                                resolutionNote: 'Denied in the Phase Console.',
                              },
                              refetchQueries: [
                                'GetAgentRequests',
                                'GetAgentRequestMesh',
                                'GetPendingAgentRequestIds',
                              ],
                              awaitRefetchQueries: true,
                            })
                            toast.success('Agent request denied')
                          }}
                        />
                      </div>
                    )}
                </div>

                <div className="space-y-4 px-4 py-4">
                  <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-neutral-500">Integration</dt>
                      <dd className="mt-1 font-medium">{humanizeAgentValue(provider)}</dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">Credential context</dt>
                      <dd className="mt-1 font-medium">
                        {request.credentialName || request.credential?.name || 'Not specified'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">Created</dt>
                      <dd className="mt-1">{formatAgentDate(request.createdAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">Expires</dt>
                      <dd className="mt-1">{formatAgentDate(request.expiresAt)}</dd>
                    </div>
                  </dl>

                  <section className="rounded-lg border border-neutral-500/20 bg-neutral-500/[0.025] p-3">
                    <h3 className="mb-2 text-xs font-semibold">Agent proposal</h3>
                    <HardenedRequestMarkdown text={request.markdown || 'No proposal supplied.'} />
                  </section>

                  {!canFulfill && isAgentRequestPending(requestStatus) && canResolve && (
                    <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
                      You can deny this request, but fulfilling it requires access to compatible
                      integration credentials and permission to manage this Agent.
                    </p>
                  )}

                  {request.credential && !isAgentRequestPending(requestStatus) && (
                    <p className="flex items-center gap-2 text-xs text-neutral-500">
                      {isUpdate ? <FaSyncAlt /> : <FaKey />}
                      Resolved with {request.credential.name} ({request.credential.provider?.name})
                    </p>
                  )}
                  {request.resolutionNote && (
                    <p className="text-xs text-neutral-500">Resolution: {request.resolutionNote}</p>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
