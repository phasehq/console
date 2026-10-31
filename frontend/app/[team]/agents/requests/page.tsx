'use client'

import { use, useContext, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import clsx from 'clsx'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { FaChevronRight, FaKey, FaSyncAlt } from 'react-icons/fa'
import { FiRefreshCw } from 'react-icons/fi'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { agentsPath } from '@/utils/agents/routes'
import { GetAgentRequests } from '@/graphql/queries/agents/getAgentRequests.gql'
import { ResolveAgentRequestOp } from '@/graphql/mutations/agents/manageAgentAssets.gql'
import { DenyAgentRequestDialog } from '@/components/agents/AgentDialogs'
import { AgentSetupRequestDialog } from '@/components/agents/AgentSetupRequestDialog'
import { HardenedRequestMarkdown } from '@/components/agents/HardenedRequestMarkdown'
import { AgentRequestStatusFilter } from '@/components/agents/AgentRequestStatusFilter'
import {
  agentRequestKindLabel,
  isAgentRequestPending,
  normalizeAgentEnum,
} from '@/components/agents/AgentEnums'
import { AgentHarnessTile } from '@/components/agents/AgentBrandIcons'
import {
  agentRequestAnchorId,
  isAgentRequestFulfillmentDeepLink,
  prioritiseAgentRequest,
} from '@/components/agents/AgentRequestDeepLink'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import {
  AgentAccessDenied,
  AgentBadge,
  AgentEmpty,
  AgentError,
  AgentPageHeader,
  AgentRequestsSkeleton,
  AgentTime,
  agentCardSurface,
  humanizeAgentValue,
} from '@/components/agents/AgentUI'

/** Pending requests show when they expire; closed ones show when they closed. */
const requestTiming = (request: {
  status: string
  expiresAt?: string | null
  resolvedAt?: string | null
}) => {
  const status = normalizeAgentEnum(request.status)
  if (isAgentRequestPending(status)) {
    const expired = !!request.expiresAt && Date.parse(request.expiresAt) <= Date.now()
    return { label: expired ? 'Expired' : 'Expires', value: request.expiresAt, fallback: 'Never' }
  }
  if (status === 'EXPIRED')
    return {
      label: 'Expired',
      value: request.expiresAt || request.resolvedAt,
      fallback: 'Unknown',
    }
  return { label: 'Resolved', value: request.resolvedAt, fallback: 'Unknown' }
}

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

export default function AgentRequestsPage(props: { params: Promise<{ team: string }> }) {
  const params = use(props.params)
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const searchParams = useSearchParams()
  const requestedRequestId = searchParams?.get('request')?.trim() || ''
  const requestedAction = searchParams?.get('action')?.trim().toLowerCase() || ''
  const [status, setStatus] = useState('')
  const [deepLinkOpened, setDeepLinkOpened] = useState(false)
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
    skipPollAttempt: () => document.hidden,
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

  // Scroll to a linked request once; polling and filters must not pull the page back.
  const scrolledToRequest = useRef('')
  useEffect(() => {
    if (!requestedRequestId || loading || scrolledToRequest.current === requestedRequestId) return
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(agentRequestAnchorId(requestedRequestId))
      if (!target) return
      scrolledToRequest.current = requestedRequestId
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      target.scrollIntoView({
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
      description="Review Connection setup and credential updates proposed by your Agents."
      action={
        hasControls ? (
          <div className="flex items-center gap-2">
            <AgentRequestStatusFilter value={status} onChange={setStatus} />
            <Button
              type="button"
              variant="secondary"
              title={refreshing ? 'Refreshing requests' : 'Refresh requests'}
              disabled={refreshing}
              onClick={() => void handleRefresh()}
            >
              <FiRefreshCw size={20} className={clsx('mr-1', refreshing && 'animate-spin')} />{' '}
              Refresh
            </Button>
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
  if (error && !data) return section(<AgentError message={error.message} retry={() => refetch()} />)

  return (
    <div className="space-y-5">
      {header}

      {requests.length === 0 ? (
        <AgentEmpty
          title="No Agent requests"
          subtitle={
            status
              ? `No ${status} requests match this filter.`
              : 'Connection and credential requests from Agent Workflows will appear here.'
          }
        />
      ) : (
        <div className="max-w-4xl space-y-3">
          {requests.map((request: any) => {
            const requestKind = normalizeAgentEnum(request.kind)
            const requestStatus = normalizeAgentEnum(request.status)
            const isUpdate = requestKind === 'CREDENTIAL_UPDATE'
            const isLinked = request.id === requestedRequestId
            // Mirrors the backend: deny needs request and Workflow update; fulfilling
            // also needs credential read and Connection create or update.
            const canDeny =
              canResolve &&
              !!permissions &&
              userHasPermission(permissions, 'AgentWorkflows', 'update')
            const canFulfill =
              canDeny &&
              canReadCredentials &&
              userHasPermission(permissions, 'AgentConnections', isUpdate ? 'update' : 'create')
            const provider = request.credentialProvider || request.serviceType
            const timing = requestTiming(request)

            return (
              <article
                key={request.id}
                id={agentRequestAnchorId(request.id)}
                className={clsx(
                  'scroll-mt-28 overflow-hidden',
                  agentCardSurface(isLinked && 'selected')
                )}
              >
                <div className="flex flex-col gap-3 border-b border-neutral-500/20 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <AgentHarnessTile harnessType={request.agent.harnessType || 'other'} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">{agentRequestKindLabel(requestKind)}</h2>
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
                      <dd className="mt-1">
                        <AgentTime value={request.createdAt} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">{timing.label}</dt>
                      <dd className="mt-1">
                        <AgentTime value={timing.value} fallback={timing.fallback} />
                      </dd>
                    </div>
                  </dl>

                  <section className="rounded-lg border border-neutral-500/20 bg-neutral-500/5 p-3">
                    <h3 className="mb-2 text-xs font-semibold">Agent proposal</h3>
                    <HardenedRequestMarkdown text={request.markdown || 'No proposal supplied.'} />
                  </section>

                  {!canFulfill && isAgentRequestPending(requestStatus) && canDeny && (
                    <Alert variant="warning" icon size="sm">
                      <span className="text-xs">
                        You can deny this request, but fulfilling it requires access to integration
                        credentials and permission to manage Agent Connections.
                      </span>
                    </Alert>
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
                {isAgentRequestPending(requestStatus) && canDeny && (
                  // After the proposal, so the decision comes once it is read: Deny at the
                  // far left, the action that resolves the request at the far right.
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-500/20 bg-neutral-500/5 px-4 py-3">
                    <DenyAgentRequestDialog
                      requestId={request.id}
                      onDeny={async (note) => {
                        await resolveRequest({
                          variables: {
                            requestId: request.id,
                            expectedRevision: request.revision,
                            approved: false,
                            resolutionNote: note || 'Denied in the Phase Console.',
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
                    {canFulfill && (
                      <AgentSetupRequestDialog
                        organisationId={organisation.id}
                        request={request}
                        canCreateCredentials={canCreateCredentials}
                        autoOpen={
                          !deepLinkOpened &&
                          isAgentRequestFulfillmentDeepLink(
                            requestedRequestId,
                            requestedAction,
                            request.id
                          )
                        }
                        onAutoOpened={() => setDeepLinkOpened(true)}
                        onDone={() => void refetch()}
                      />
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
