'use client'

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApolloClient, useMutation, useQuery } from '@apollo/client'
import { FaCheck, FaChevronDown, FaFilter, FaSyncAlt, FaTimes } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { GetAgentEvents } from '@/graphql/queries/agents/getAgentEvents.gql'
import { AllowAgentConnectionHostOp } from '@/graphql/mutations/agents/manageAgentAssets.gql'
import { Button } from '@/components/common/Button'
import {
  AgentBadge,
  AgentEmpty,
  AgentLoading,
  formatAgentDate,
  humanizeAgentValue,
} from './AgentUI'
import {
  agentEventKey,
  agentEventAuthority,
  blockedHostConnectionCandidate,
  blockedHostConnectionCandidates,
  mergeAgentEventRows,
  type AgentEventConnectionCandidate,
  type AgentEventRow,
  type AgentEventWorkflow,
} from './AgentEventLogUtils'
import { AgentSelect } from './AgentSelect'

const PAGE_SIZE = 100
const TAIL_PAGE_SIZE = 200
const MAX_CATCH_UP_PAGES = 25

const selectClass =
  'custom w-full rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-800 ring-1 ring-inset ring-neutral-500/40 focus:ring-emerald-500 dark:bg-zinc-800 dark:text-zinc-100'

type EventPage = {
  events: AgentEventRow[]
  nextCursor: string
  hasMore: boolean
}

type EventFilters = {
  workflowId: string
  sessionUid: string
  proxyDecision: string
  provider: string
}

const emptyFilters: EventFilters = {
  workflowId: '',
  sessionUid: '',
  proxyDecision: '',
  provider: '',
}

type AllowedHostStatus = 'allowed' | 'host_review_pending'

const allowedHostStatusLabel = (status: AllowedHostStatus) => {
  if (status === 'host_review_pending') return 'Host review pending'
  return 'Host allowed'
}

export function AgentEventLog({
  organisationId,
  agentId,
  agentName,
  workflows,
  sessions,
  canRead,
  canAllowHosts,
}: {
  organisationId: string
  agentId: string
  agentName: string
  workflows: AgentEventWorkflow[]
  sessions: Array<{ sessionUid: string; workflow: { id: string; name: string } }>
  canRead: boolean
  canAllowHosts: boolean
}) {
  const client = useApolloClient()
  const requestGeneration = useRef(0)
  const [filters, setFilters] = useState<EventFilters>(emptyFilters)
  const [providerDraft, setProviderDraft] = useState('')
  const [events, setEvents] = useState<AgentEventRow[]>([])
  const [cursor, setCursor] = useState('0')
  const [hasMore, setHasMore] = useState(false)
  const [caughtUp, setCaughtUp] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [catchingUp, setCatchingUp] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [expandedEvent, setExpandedEvent] = useState('')
  const [allowingEvent, setAllowingEvent] = useState('')
  const [allowedHosts, setAllowedHosts] = useState<Record<string, AllowedHostStatus>>({})
  const [allowHost] = useMutation(AllowAgentConnectionHostOp)

  const baseVariables = useMemo(
    () => ({
      organisationId,
      agentId,
      workflowId: filters.workflowId || null,
      sessionUid: filters.sessionUid || null,
      proxyDecision: filters.proxyDecision || null,
      provider: filters.provider || null,
    }),
    [agentId, filters, organisationId]
  )

  const readPage = useCallback(
    async (after: string, limit = PAGE_SIZE): Promise<EventPage> => {
      const result = await client.query({
        query: GetAgentEvents,
        variables: { ...baseVariables, cursor: after, limit },
        fetchPolicy: 'network-only',
      })
      const page = result.data?.agentEvents
      return {
        events: (page?.events || []).filter(Boolean) as AgentEventRow[],
        nextCursor: page?.nextCursor || after,
        hasMore: !!page?.hasMore,
      }
    },
    [baseVariables, client]
  )

  useEffect(() => {
    const generation = ++requestGeneration.current
    if (!canRead || !organisationId || !agentId) {
      setEvents([])
      setCaughtUp(false)
      setLoadingHistory(false)
      setCatchingUp(false)
      return
    }
    setEvents([])
    setCursor('0')
    setHasMore(false)
    setCaughtUp(false)
    setExpandedEvent('')
    setCatchingUp(false)
    setLoadingHistory(true)
    setHistoryError('')

    readPage('0')
      .then((page) => {
        if (generation !== requestGeneration.current) return
        setEvents(page.events)
        setCursor(page.nextCursor)
        setHasMore(page.hasMore)
        setCaughtUp(!page.hasMore)
      })
      .catch((error: unknown) => {
        if (generation !== requestGeneration.current) return
        setHistoryError(error instanceof Error ? error.message : 'Unable to load Agent events')
      })
      .finally(() => {
        if (generation === requestGeneration.current) setLoadingHistory(false)
      })
  }, [agentId, canRead, organisationId, readPage])

  const {
    data: tailData,
    error: tailError,
    loading: tailLoading,
  } = useQuery(GetAgentEvents, {
    variables: { ...baseVariables, cursor, limit: TAIL_PAGE_SIZE },
    skip: !canRead || !caughtUp,
    fetchPolicy: 'network-only',
    pollInterval: 5000,
    notifyOnNetworkStatusChange: false,
  })

  useEffect(() => {
    if (!caughtUp || !tailData?.agentEvents) return
    const page = tailData.agentEvents
    const incoming = (page.events || []).filter(Boolean) as AgentEventRow[]
    if (incoming.length) setEvents((current) => mergeAgentEventRows(current, incoming))
    if (page.nextCursor && page.nextCursor !== cursor) setCursor(page.nextCursor)
  }, [caughtUp, cursor, tailData])

  const loadNextPage = async () => {
    const generation = requestGeneration.current
    setLoadingHistory(true)
    setHistoryError('')
    try {
      const page = await readPage(cursor)
      if (generation !== requestGeneration.current) return
      setEvents((current) => mergeAgentEventRows(current, page.events))
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
      setCaughtUp(!page.hasMore)
    } catch (error) {
      if (generation !== requestGeneration.current) return
      setHistoryError(error instanceof Error ? error.message : 'Unable to load newer events')
    } finally {
      if (generation === requestGeneration.current) setLoadingHistory(false)
    }
  }

  const catchUpToLive = async () => {
    const generation = requestGeneration.current
    setCatchingUp(true)
    setHistoryError('')
    let nextCursor = cursor
    let more = hasMore
    let pages = 0
    let nextEvents = events
    try {
      while (more && pages < MAX_CATCH_UP_PAGES) {
        const page = await readPage(nextCursor, TAIL_PAGE_SIZE)
        if (generation !== requestGeneration.current) return
        nextEvents = mergeAgentEventRows(nextEvents, page.events)
        nextCursor = page.nextCursor
        more = page.hasMore
        pages += 1
      }
      setEvents(nextEvents)
      setCursor(nextCursor)
      setHasMore(more)
      setCaughtUp(!more)
      if (more)
        setHistoryError(
          `More than ${MAX_CATCH_UP_PAGES * TAIL_PAGE_SIZE} newer events remain. Catch up again to continue.`
        )
    } catch (error) {
      if (generation !== requestGeneration.current) return
      setHistoryError(error instanceof Error ? error.message : 'Unable to catch up to live events')
    } finally {
      if (generation === requestGeneration.current) setCatchingUp(false)
    }
  }

  const applyProviderFilter = (event: FormEvent) => {
    event.preventDefault()
    setFilters((current) => ({ ...current, provider: providerDraft.trim() }))
  }

  const clearFilters = () => {
    setProviderDraft('')
    setFilters(emptyFilters)
  }

  const permanentlyAllowHost = async (
    event: AgentEventRow,
    connection: AgentEventConnectionCandidate
  ) => {
    const eventKey = agentEventKey(event)
    const endpoint = agentEventAuthority(event)
    const hostKey = `${connection.id}:${endpoint.toLowerCase()}`
    setAllowingEvent(eventKey)
    try {
      const result = await allowHost({
        variables: {
          eventIngestSeq: String(event.ingestSeq),
          connectionId: connection.id,
          expectedVersion: connection.hostRulesVersion,
        },
        refetchQueries: ['GetAgentDetail', 'GetAgentAssets'],
        awaitRefetchQueries: true,
      })
      const approvalRequired = !!result.data?.allowAgentConnectionHost?.approvalRequired
      const status: AllowedHostStatus = approvalRequired ? 'host_review_pending' : 'allowed'
      setAllowedHosts((current) => ({
        ...current,
        [hostKey]: status,
      }))
      toast.success(
        approvalRequired
          ? `${endpoint} was added to ${connection.name}. A different member must approve the host change before it can be used.`
          : `${endpoint} is now allowed on ${connection.name}.`
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to allow this host')
    } finally {
      setAllowingEvent('')
    }
  }

  if (!canRead)
    return (
      <AgentEmpty
        title="Access restricted"
        subtitle="You do not have permission to view Agent runtime logs."
      />
    )

  const displayedEvents = [...events].reverse()
  const filtersActive = Object.values(filters).some(Boolean)

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-neutral-500/20 p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-1.5 block text-2xs text-neutral-500" htmlFor="event-workflow">
                Workflow
              </label>
              <AgentSelect
                id="event-workflow"
                value={filters.workflowId}
                onChange={(workflowId) => setFilters((current) => ({ ...current, workflowId }))}
                options={[
                  { value: '', label: 'All workflows' },
                  ...workflows.map((workflow) => ({
                    value: workflow.id,
                    label: workflow.name,
                  })),
                ]}
                size="xs"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-2xs text-neutral-500" htmlFor="event-session">
                Session
              </label>
              <AgentSelect
                id="event-session"
                value={filters.sessionUid}
                onChange={(sessionUid) => setFilters((current) => ({ ...current, sessionUid }))}
                options={[
                  { value: '', label: 'All sessions' },
                  ...sessions.map((session) => ({
                    value: session.sessionUid,
                    label: `${session.workflow.name} / ${session.sessionUid.slice(0, 12)}`,
                  })),
                ]}
                size="xs"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-2xs text-neutral-500" htmlFor="event-decision">
                Proxy decision
              </label>
              <AgentSelect
                id="event-decision"
                value={filters.proxyDecision}
                onChange={(proxyDecision) =>
                  setFilters((current) => ({ ...current, proxyDecision }))
                }
                options={[
                  { value: '', label: 'All decisions' },
                  { value: 'allow', label: 'Allow' },
                  { value: 'block', label: 'Block' },
                  { value: 'auth_deny', label: 'Authentication denied' },
                  { value: 'error', label: 'Error' },
                ]}
                size="xs"
              />
            </div>
            <form onSubmit={applyProviderFilter}>
              <label className="mb-1.5 block text-2xs text-neutral-500" htmlFor="event-provider">
                Provider
              </label>
              <div className="flex gap-1.5">
                <input
                  id="event-provider"
                  className={selectClass}
                  value={providerDraft}
                  onChange={(event) => setProviderDraft(event.target.value)}
                  placeholder="Exact provider"
                />
                <Button type="submit" variant="secondary" title="Apply provider filter">
                  <FaFilter />
                </Button>
              </div>
            </form>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {filtersActive && (
              <Button type="button" variant="secondary" onClick={clearFilters}>
                <FaTimes /> Clear filters
              </Button>
            )}
            {hasMore ? (
              <AgentBadge tone="amber">History, live polling paused</AgentBadge>
            ) : (
              <AgentBadge tone="green">
                {tailLoading ? 'Checking for events' : 'Live polling'}
              </AgentBadge>
            )}
          </div>
        </div>
      </div>

      {(historyError || tailError) && (
        <div
          role="alert"
          className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400"
        >
          {historyError || tailError?.message}
        </div>
      )}

      {loadingHistory && events.length === 0 ? (
        <AgentLoading />
      ) : displayedEvents.length === 0 ? (
        <AgentEmpty
          title="No Agent events"
          subtitle={
            filtersActive
              ? 'No events match these filters.'
              : 'Proxy, credential, and runtime events will appear here.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-500/20">
          <table className="min-w-full divide-y divide-neutral-500/20 text-xs">
            <thead className="bg-neutral-500/5 text-left text-2xs uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Endpoint</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Proxy decision</th>
                <th className="px-4 py-3">Latency</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-500/20">
              {displayedEvents.map((event) => {
                const key = agentEventKey(event)
                const expanded = expandedEvent === key
                const connectionCandidates = blockedHostConnectionCandidates(event, workflows)
                const connection = blockedHostConnectionCandidate(event, workflows)
                const endpoint = agentEventAuthority(event)
                const hostStatus = connection
                  ? allowedHosts[`${connection.id}:${endpoint.toLowerCase()}`]
                  : undefined
                return (
                  <Fragment key={key}>
                    <tr className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-500">
                        {formatAgentDate(event.proxyCreatedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{agentName}</div>
                        <div className="text-2xs text-neutral-500">
                          {event.workflow?.name || 'Unknown workflow'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">
                          {event.method || humanizeAgentValue(event.eventType)}
                        </div>
                        <div className="text-2xs text-neutral-500">{event.protocol}</div>
                      </td>
                      <td className="max-w-xs px-4 py-3">
                        <div className="truncate" title={`${endpoint}${event.path || ''}`}>
                          {endpoint || 'Runtime'}
                          {event.path || ''}
                        </div>
                        <div className="text-2xs text-neutral-500">
                          {event.connection?.name ||
                            (connection ? `Target: ${connection.name}` : 'No connection')}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{event.provider || 'Runtime'}</div>
                      </td>
                      <td className="px-4 py-3 text-neutral-500">
                        {event.statusCode == null
                          ? event.outcome || 'No status'
                          : `HTTP ${event.statusCode}`}
                      </td>
                      <td className="px-4 py-3">
                        <AgentBadge>{humanizeAgentValue(event.proxyDecision)}</AgentBadge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-500">
                        {event.latencyMs == null ? 'Unknown' : `${event.latencyMs} ms`}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {canAllowHosts &&
                            connectionCandidates.length === 1 &&
                            (hostStatus && connection ? (
                              <AgentBadge tone={hostStatus === 'allowed' ? 'green' : 'amber'}>
                                {allowedHostStatusLabel(hostStatus)}
                              </AgentBadge>
                            ) : (
                              <Button
                                type="button"
                                variant="secondary"
                                title={
                                  connection
                                    ? connection.requiresHostReview
                                      ? `Permanently add ${endpoint} to ${connection.name} for review`
                                      : `Permanently allow ${endpoint} on ${connection.name}`
                                    : undefined
                                }
                                aria-label={
                                  connection
                                    ? connection.requiresHostReview
                                      ? `Permanently add ${endpoint} to ${connection.name} for review`
                                      : `Permanently allow ${endpoint} on ${connection.name}`
                                    : undefined
                                }
                                isLoading={allowingEvent === key}
                                disabled={!!allowingEvent}
                                onClick={() => permanentlyAllowHost(event, connection!)}
                              >
                                <FaCheck />
                                {connection?.requiresHostReview
                                  ? 'Add host for review'
                                  : 'Allow host'}
                              </Button>
                            ))}
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? 'Hide' : 'Show'} details for event ${event.eventId}`}
                            className="rounded-md p-2 text-neutral-500 hover:bg-neutral-500/10 hover:text-zinc-900 dark:hover:text-zinc-100"
                            onClick={() => setExpandedEvent(expanded ? '' : key)}
                          >
                            <FaChevronDown className={expanded ? 'rotate-180' : ''} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={9} className="bg-neutral-500/[0.025] px-4 py-3">
                          <div className="grid gap-3 text-2xs sm:grid-cols-2 xl:grid-cols-4">
                            <div>
                              <span className="text-neutral-500">Event ID</span>
                              <code className="mt-0.5 block break-all">{event.eventId}</code>
                            </div>
                            <div>
                              <span className="text-neutral-500">Session</span>
                              <code className="mt-0.5 block break-all">
                                {event.session?.sessionUid || 'Unavailable'}
                              </code>
                            </div>
                            <div>
                              <span className="text-neutral-500">Ingested</span>
                              <span className="mt-0.5 block">
                                {formatAgentDate(event.ingestedAt)}
                              </span>
                            </div>
                            <div>
                              <span className="text-neutral-500">Outcome</span>
                              <span className="mt-0.5 block">{event.outcome || 'Unknown'}</span>
                            </div>
                            <div>
                              <span className="text-neutral-500">Bytes in / out</span>
                              <span className="mt-0.5 block">
                                {event.bytesIn ?? 0} / {event.bytesOut ?? 0}
                              </span>
                            </div>
                            <div>
                              <span className="text-neutral-500">Credential action</span>
                              <span className="mt-0.5 block">
                                {humanizeAgentValue(event.credentialAction)}
                              </span>
                            </div>
                            <div className="sm:col-span-2">
                              <span className="text-neutral-500">Reason</span>
                              <span className="mt-0.5 block whitespace-pre-wrap">
                                {event.reason || 'No reason recorded'}
                              </span>
                            </div>
                          </div>
                          <div className="mt-3">
                            <span className="text-2xs text-neutral-500">Redacted detail</span>
                            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-zinc-950 p-3 font-mono text-2xs text-neutral-200">
                              {JSON.stringify(event.detail || {}, null, 2)}
                            </pre>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-neutral-500/5 p-3">
          <p className="text-xs text-neutral-500">
            Newer history remains. Live polling starts after the cursor reaches the current tail.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={loadNextPage}
              isLoading={loadingHistory}
            >
              Load next {PAGE_SIZE}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={catchUpToLive}
              isLoading={catchingUp}
            >
              <FaSyncAlt /> Catch up to live
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
