'use client'

import { Fragment, use, useContext, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import clsx from 'clsx'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  FaChevronDown,
  FaChevronRight,
  FaChevronUp,
  FaInbox,
  FaKey,
  FaSyncAlt,
} from 'react-icons/fa'
import { FiChevronsDown, FiRefreshCw } from 'react-icons/fi'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { agentsPath } from '@/utils/agents/routes'
import {
  REQUEST_ACTION_TYPES,
  requestActionPermission,
  requestActionType,
} from '@/utils/agents/requestActions'
import { GetAgentRequests } from '@/graphql/queries/agents/getAgentRequests.gql'
import { ResolveAgentRequestOp } from '@/graphql/mutations/agents/manageAgentAssets.gql'
import { DenyAgentRequestDialog } from '@/components/agents/AgentDialogs'
import { AgentSetupRequestDialog } from '@/components/agents/AgentSetupRequestDialog'
import {
  AgentAccessSummary,
  AgentActionApproveDialog,
  AgentActionReview,
} from '@/components/agents/AgentActionRequest'
import { HardenedRequestMarkdown } from '@/components/agents/HardenedRequestMarkdown'
import { AgentRequestResolver } from '@/components/agents/AgentRequestResolver'
import { AgentRequestStatusFilter } from '@/components/agents/AgentRequestStatusFilter'
import { AgentRequestReviewers } from '@/components/agents/AgentRequestReviewers'
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
  AgentRequestsSkeleton,
  AgentTime,
  agentCardSurface,
  humanizeAgentValue,
} from '@/components/agents/AgentUI'
import { WithheldApp } from '@/components/agents/WithheldAsset'

// 15 at a time. The server never returns more than its cap.
const PAGE_SIZE = 15
const REQUEST_LIST_LIMIT = 200

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
  const [reviewRequested, setReviewRequested] = useState(false)
  const [pages, setPages] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  // Resolved requests start collapsed, except a linked one; these are the ones open.
  const [openRequests, setOpenRequests] = useState<Set<string>>(
    () => new Set(requestedRequestId ? [requestedRequestId] : [])
  )
  const [deepLinkOpened, setDeepLinkOpened] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const permissions = organisation?.role?.permissions
  const canRead = !!permissions && userHasPermission(permissions, 'AgentRequests', 'read')
  const canResolve = !!permissions && userHasPermission(permissions, 'AgentRequests', 'update')
  const canReadCredentials =
    !!permissions && userHasPermission(permissions, 'IntegrationCredentials', 'read')
  const canCreateCredentials =
    !!permissions && userHasPermission(permissions, 'IntegrationCredentials', 'create')
  // The member's own requests: on their Workflows, on Agents they created, and those they were
  // asked to review. Pending first, then newest first. The window grows with each Load more and
  // is polled whole, so every loaded request stays current.
  const shown = Math.min(pages * PAGE_SIZE, REQUEST_LIST_LIMIT)
  const {
    data: currentData,
    previousData,
    loading,
    error,
    refetch,
  } = useQuery(GetAgentRequests, {
    variables: {
      organisationId: organisation?.id,
      status: status || null,
      scope: reviewRequested ? 'review_requested' : 'mine',
      // One past the window, to tell whether there is more.
      limit: Math.min(shown + 1, REQUEST_LIST_LIMIT),
    },
    skip: !organisation?.id || !canRead,
    fetchPolicy: 'cache-and-network',
    pollInterval: 10000,
    skipPollAttempt: () => document.hidden,
  })
  // A linked request can sit past the loaded window, or be one the member can read but is not
  // their own, so it loads on its own.
  const { data: linkedData } = useQuery(GetAgentRequests, {
    variables: { organisationId: organisation?.id, requestId: requestedRequestId, limit: 1 },
    skip: !organisation?.id || !canRead || !requestedRequestId,
    fetchPolicy: 'cache-and-network',
    pollInterval: 10000,
    skipPollAttempt: () => document.hidden,
  })
  // While Load more fetches the bigger window, the loaded requests stay on screen.
  const data = currentData ?? (loadingMore ? previousData : undefined)
  useEffect(() => {
    if (currentData) setLoadingMore(false)
  }, [currentData])
  // A bigger window that failed to load stops spinning: back to the window that loaded,
  // with the error shown as a failed refresh is.
  useEffect(() => {
    if (!error || !loadingMore) return
    setLoadingMore(false)
    setPages((current) => Math.max(1, current - 1))
    toast.error('Unable to load more change requests')
    // Only a new error ends a load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error])
  const [resolveRequest] = useMutation(ResolveAgentRequestOp)
  const listed = (data?.agentRequests || []).filter(Boolean)
  const inWindow = listed.slice(0, shown)
  const hasMore = listed.length > shown
  const linked = linkedData?.agentRequests?.[0]
  // A linked request shows whatever its state, unless a filter excludes it.
  const showLinked =
    !!linked &&
    (!status || normalizeAgentEnum(linked.status) === normalizeAgentEnum(status)) &&
    (!reviewRequested || inWindow.some((request: { id: string }) => request.id === linked.id)) &&
    !inWindow.some((request: { id: string }) => request.id === linked.id)
  const requests = prioritiseAgentRequest<any>(
    showLinked ? [linked, ...inWindow] : inWindow,
    requestedRequestId
  )
  const toggleRequest = (id: string) =>
    setOpenRequests((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refetch()
    } catch {
      toast.error('Unable to refresh change requests')
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

  // Requests are raised elsewhere, so this section has no create action.
  // Refresh and the status filter are only useful once there is something to
  // act on, or a filter to clear.
  const hasControls = requests.length > 0 || !!status || reviewRequested
  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-lg font-semibold sm:text-xl">Change Requests</h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          Changes asked for on your Agents and Workflows, and those you are asked to review.
        </p>
      </div>
      {hasControls && (
        <div className="flex items-center gap-2">
          <AgentRequestStatusFilter
            value={status}
            onChange={(value) => {
              setStatus(value)
              setPages(1)
            }}
            reviewRequested={reviewRequested}
            onReviewRequestedChange={(value) => {
              setReviewRequested(value)
              setPages(1)
            }}
          />
          <Button
            type="button"
            variant="secondary"
            icon={FiRefreshCw}
            title={refreshing ? 'Refreshing requests' : 'Refresh requests'}
            isLoading={refreshing}
            onClick={() => void handleRefresh()}
          >
            Refresh
          </Button>
        </div>
      )}
    </div>
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
      <AgentAccessDenied subtitle="You do not have permission to review change requests." />
    )
  if (error && !data) return section(<AgentError message={error.message} retry={() => refetch()} />)

  return (
    <div className="space-y-5">
      {header}

      {requests.length === 0 ? (
        <AgentEmpty
          icon={FaInbox}
          title={
            reviewRequested
              ? status
                ? `No ${status} requests asked of you`
                : 'Nothing waiting on your review'
              : status
                ? `No ${status} change requests`
                : 'No change requests yet'
          }
          subtitle={
            <span className="mx-auto mt-1 block max-w-md">
              {reviewRequested || status
                ? 'Try another filter, or clear the filters to see all of your requests.'
                : 'When an Agent or a member asks for a change to your Agents or Workflows, or asks you to review one, it shows up here to approve or deny.'}
            </span>
          }
        >
          {(reviewRequested || !!status) && (
            <Button
              variant="secondary"
              onClick={() => {
                setStatus('')
                setReviewRequested(false)
                setPages(1)
              }}
            >
              Clear filters
            </Button>
          )}
        </AgentEmpty>
      ) : (
        <div className="max-w-4xl space-y-3">
          {requests.map((request: any, index: number) => {
            const requestKind = normalizeAgentEnum(request.kind)
            const requestStatus = normalizeAgentEnum(request.status)
            const isUpdate = requestKind === 'CREDENTIAL_UPDATE'
            const isLinked = request.id === requestedRequestId
            // A request that carries a typed action is reviewed as a diff and approved, not fulfilled.
            const actionType = requestActionType(request.action)
            const hasAction = !!request.action
            // Mirrors the backend's deny and fulfil permission checks.
            const canDeny =
              canResolve &&
              !!permissions &&
              userHasPermission(permissions, 'AgentWorkflows', 'update')
            const canFulfill =
              canDeny &&
              canReadCredentials &&
              userHasPermission(permissions, 'AgentConnections', isUpdate ? 'update' : 'create')
            const actionPermission = actionType ? requestActionPermission(actionType) : null
            const canApproveAction =
              canDeny &&
              !!actionType &&
              (!actionPermission ||
                userHasPermission(permissions, 'AgentConnections', actionPermission))
            const provider = request.credentialProvider || request.serviceType
            const timing = requestTiming(request)
            const pending = isAgentRequestPending(requestStatus)
            const open = pending || openRequests.has(request.id)
            const detailsId = `${agentRequestAnchorId(request.id)}-details`
            // Open requests come first; a rule sets the resolved ones apart.
            const firstResolved =
              !pending &&
              index > 0 &&
              isAgentRequestPending(normalizeAgentEnum(requests[index - 1].status))

            return (
              <Fragment key={request.id}>
                {firstResolved && (
                  <div
                    role="separator"
                    className="flex items-center gap-3 pt-3 text-2xs font-semibold uppercase tracking-wider text-neutral-500"
                  >
                    Resolved
                    <span aria-hidden="true" className="h-px flex-1 bg-neutral-500/20" />
                  </div>
                )}
                <article
                  id={agentRequestAnchorId(request.id)}
                  className={clsx(
                    'scroll-mt-28 overflow-hidden',
                    // Amber, like every pending request marker; a linked resolved one stays emerald.
                    agentCardSurface(isLinked && (pending ? 'attention' : 'selected'))
                  )}
                >
                  <div
                    className={clsx(
                      'flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
                      open && 'border-b border-neutral-500/20'
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <AgentHarnessTile harnessType={request.agent.harnessType || 'other'} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-semibold">
                            {hasAction && request.title
                              ? request.title
                              : agentRequestKindLabel(requestKind)}
                          </h2>
                          <AgentBadge tone={requestStatusTone(requestStatus)}>
                            {humanizeAgentValue(requestStatus)}
                          </AgentBadge>
                          {request.appRestricted && <WithheldApp className="text-xs" />}
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
                    {!pending && (
                      // A resolved request needs only its outcome; the detail opens on demand.
                      <div className="flex min-w-0 items-center gap-2 pl-12 text-xs text-neutral-500 sm:max-w-sm sm:shrink-0 sm:pl-0">
                        <span className="shrink-0">
                          {humanizeAgentValue(requestStatus)}{' '}
                          <AgentTime value={timing.value} fallback={timing.fallback} />
                        </span>
                        <AgentRequestResolver
                          member={request.resolvedBy}
                          className="max-w-[10rem]"
                        />
                        <Button
                          variant="ghost"
                          icon={open ? FaChevronUp : FaChevronDown}
                          iconPosition="right"
                          aria-expanded={open}
                          aria-controls={detailsId}
                          title={open ? 'Hide details' : 'Show details'}
                          onClick={() => toggleRequest(request.id)}
                        >
                          Details
                        </Button>
                      </div>
                    )}
                  </div>

                  {open && (
                    <div id={detailsId} className="space-y-4 px-4 py-4">
                      <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                        {hasAction ? (
                          <>
                            <div>
                              <dt className="text-neutral-500">Request</dt>
                              <dd className="mt-1 font-medium">
                                {agentRequestKindLabel(requestKind)}
                              </dd>
                            </div>
                            {actionType !== REQUEST_ACTION_TYPES.contextUpdate && (
                              <div>
                                <dt className="text-neutral-500">
                                  {/* Until approved, an app access request names only its app. */}
                                  {actionType === REQUEST_ACTION_TYPES.appAccess &&
                                  !request.connection
                                    ? 'App'
                                    : 'Connection'}
                                </dt>
                                <dd className="mt-1 font-medium">
                                  {request.connection?.name ||
                                    (request.appRestricted ? (
                                      <WithheldApp />
                                    ) : (
                                      request.credentialName || 'Not created yet'
                                    ))}
                                </dd>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div>
                              <dt className="text-neutral-500">Integration</dt>
                              <dd className="mt-1 font-medium">{humanizeAgentValue(provider)}</dd>
                            </div>
                            <div>
                              <dt className="text-neutral-500">Credential context</dt>
                              <dd className="mt-1 font-medium">
                                {request.credentialName ||
                                  request.credential?.name ||
                                  'Not specified'}
                              </dd>
                            </div>
                          </>
                        )}
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
                        {(pending || request.reviewers?.length > 0) && (
                          <div className="min-w-0 sm:col-span-2">
                            <dt className="text-neutral-500">Reviewers</dt>
                            <dd className="mt-1">
                              <AgentRequestReviewers
                                requestId={request.id}
                                organisationId={organisation.id}
                                reviewers={request.reviewers || []}
                                pending={pending}
                              />
                            </dd>
                          </div>
                        )}
                        {!pending && request.resolvedBy && (
                          <div className="min-w-0">
                            <dt className="text-neutral-500">
                              {requestStatus === 'DENIED' ? 'Denied by' : 'Approved by'}
                            </dt>
                            <dd className="mt-1">
                              <AgentRequestResolver member={request.resolvedBy} detailed />
                            </dd>
                          </div>
                        )}
                      </dl>

                      {/* With an action the note is optional; without one it is the whole request. */}
                      {(!hasAction || !!request.markdown?.trim()) && (
                        <section className="rounded-lg border border-neutral-500/20 bg-neutral-500/5 p-3">
                          <h3 className="mb-2 text-xs font-semibold">{"Agent's note"}</h3>
                          <HardenedRequestMarkdown text={request.markdown || 'No note supplied.'} />
                        </section>
                      )}

                      {hasAction && <AgentActionReview request={request} />}
                      {!hasAction && <AgentAccessSummary request={request} />}

                      {!hasAction &&
                        !canFulfill &&
                        isAgentRequestPending(requestStatus) &&
                        canDeny && (
                          <Alert variant="warning" icon size="sm">
                            <span className="text-xs">
                              You can deny this request, but fulfilling it requires access to
                              integration credentials and permission to manage Agent Connections.
                            </span>
                          </Alert>
                        )}
                      {hasAction &&
                        !canApproveAction &&
                        isAgentRequestPending(requestStatus) &&
                        canDeny && (
                          <Alert variant="warning" icon size="sm">
                            <span className="text-xs">
                              {actionType
                                ? 'You can deny this request, but approving it requires more permissions than you have.'
                                : 'This request carries an action this version of the Console cannot apply. You can deny it.'}
                            </span>
                          </Alert>
                        )}

                      {request.credential && !isAgentRequestPending(requestStatus) && (
                        <p className="flex items-center gap-2 text-xs text-neutral-500">
                          {isUpdate ? <FaSyncAlt /> : <FaKey />}
                          Resolved with {request.credential.name} (
                          {request.credential.provider?.name})
                        </p>
                      )}
                      {request.resolutionNote && (
                        <p className="text-xs text-neutral-500">
                          Resolution: {request.resolutionNote}
                        </p>
                      )}
                    </div>
                  )}
                  {pending && canDeny && (
                    // After the request, so the decision follows reading it.
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
                              'GetPendingAgentRequestCount',
                            ],
                            awaitRefetchQueries: true,
                          })
                          toast.success('Change request denied')
                        }}
                      />
                      {hasAction && canApproveAction && (
                        <AgentActionApproveDialog
                          request={request}
                          organisationId={organisation.id}
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
                      {!hasAction && canFulfill && (
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
              </Fragment>
            )
          })}
          {/* The same footer as the log screens: Load more, or a line saying the list has ended. */}
          <div className="flex justify-center px-6 py-4 font-medium text-neutral-500">
            {hasMore ? (
              <Button
                variant="secondary"
                icon={FiChevronsDown}
                isLoading={loadingMore}
                onClick={() => {
                  setLoadingMore(true)
                  setPages((current) => current + 1)
                }}
              >
                Load more
              </Button>
            ) : listed.length >= REQUEST_LIST_LIMIT ? (
              <span className="text-sm">
                Showing the latest {REQUEST_LIST_LIMIT} requests. Filter by status to see older
                ones.
              </span>
            ) : (
              <span className="text-sm">No more requests to show</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
