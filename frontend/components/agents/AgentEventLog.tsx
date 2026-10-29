'use client'

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApolloClient, useMutation, useQuery } from '@apollo/client'
import { FaCheck, FaChevronDown, FaFilter, FaHistory, FaTimes } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { GetAgentEvents } from '@/graphql/queries/agents/getAgentEvents.gql'
import { AllowAgentConnectionHostOp } from '@/graphql/mutations/agents/manageAgentAssets.gql'
import { Button } from '@/components/common/Button'
import { ConfirmAgentAction } from './AgentDialogs'
import {
  AgentAccessDenied,
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
  newestAgentEventSequence,
  type AgentEventConnectionCandidate,
  type AgentEventRow,
  type AgentEventWorkflow,
} from './AgentEventLogUtils'
import { AgentSelect } from './AgentSelect'

const PAGE_SIZE = 100
const TAIL_PAGE_SIZE = 200
// Older pages stop here; narrower filters reach further back.
const MAX_EVENT_ROWS = 1000

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

function AllowHostAction({
  endpoint,
  connection,
  allowing,
  disabled,
  onConfirm,
}: {
  endpoint: string
  connection: AgentEventConnectionCandidate
  allowing: boolean
  disabled: boolean
  onConfirm: () => Promise<void>
}) {
  const label = connection.requiresHostReview ? 'Add host for review' : 'Allow host'
  const target = connection.requiresHostReview
    ? `Permanently add ${endpoint} to ${connection.name} for review`
    : `Permanently allow ${endpoint} on ${connection.name}`
  const consequence = connection.requiresHostReview
    ? `${endpoint} will be added to ${connection.name}. A different member must approve it before Agents can use it.`
    : `${endpoint} will be permanently allowed on ${connection.name}. Every Workflow granted this Connection can reach it.`

  return (
    <ConfirmAgentAction
      title={label}
      description={`${consequence} Active sessions using ${connection.name} end and must be restarted.`}
      actionLabel={label}
      danger={false}
      triggerVariant="secondary"
      triggerContent={label}
      triggerProps={{
        icon: FaCheck,
        'aria-label': target,
        title: connection.hostReviewPending
          ? `Approve the hosts waiting for review on ${connection.name} first`
          : target,
        isLoading: allowing,
        disabled: disabled || !!connection.hostReviewPending,
      }}
      onConfirm={onConfirm}
    />
  )
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
  // The live tail polls forward from the newest event; history pages back from the oldest.
  const [liveCursor, setLiveCursor] = useState<string | null>(null)
  const [olderCursor, setOlderCursor] = useState('0')
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
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

  const readHistory = useCallback(
    async (before?: string): Promise<EventPage> => {
      const result = await client.query({
        query: GetAgentEvents,
        variables: { ...baseVariables, newestFirst: true, before, limit: PAGE_SIZE },
        fetchPolicy: 'no-cache',
      })
      const page = result.data?.agentEvents
      return {
        events: (page?.events || []).filter(Boolean) as AgentEventRow[],
        nextCursor: page?.nextCursor || before || '0',
        hasMore: !!page?.hasMore,
      }
    },
    [baseVariables, client]
  )

  useEffect(() => {
    const generation = ++requestGeneration.current
    setEvents([])
    setLiveCursor(null)
    setOlderCursor('0')
    setHasOlder(false)
    setExpandedEvent('')
    setHistoryError('')
    if (!canRead || !organisationId || !agentId) {
      setLoadingHistory(false)
      return
    }
    setLoadingHistory(true)

    readHistory()
      .then((page) => {
        if (generation !== requestGeneration.current) return
        setEvents(mergeAgentEventRows([], page.events, MAX_EVENT_ROWS))
        setOlderCursor(page.nextCursor)
        setHasOlder(page.hasMore)
        setLiveCursor(newestAgentEventSequence(page.events))
      })
      .catch((error: unknown) => {
        if (generation !== requestGeneration.current) return
        setHistoryError(error instanceof Error ? error.message : 'Unable to load Agent events')
      })
      .finally(() => {
        if (generation === requestGeneration.current) setLoadingHistory(false)
      })
  }, [agentId, canRead, organisationId, readHistory])

  const {
    data: tailData,
    error: tailError,
    loading: tailLoading,
  } = useQuery(GetAgentEvents, {
    variables: { ...baseVariables, cursor: liveCursor, limit: TAIL_PAGE_SIZE },
    skip: !canRead || liveCursor === null,
    fetchPolicy: 'no-cache',
    pollInterval: 5000,
    skipPollAttempt: () => document.hidden,
    notifyOnNetworkStatusChange: false,
  })

  useEffect(() => {
    if (liveCursor === null || !tailData?.agentEvents) return
    const page = tailData.agentEvents
    const incoming = (page.events || []).filter(Boolean) as AgentEventRow[]
    if (incoming.length)
      setEvents((current) =>
        mergeAgentEventRows(current, incoming, Math.max(MAX_EVENT_ROWS, current.length))
      )
    if (page.nextCursor && page.nextCursor !== liveCursor) setLiveCursor(page.nextCursor)
  }, [liveCursor, tailData])

  const loadOlder = async () => {
    const generation = requestGeneration.current
    setLoadingHistory(true)
    setHistoryError('')
    try {
      const page = await readHistory(olderCursor)
      if (generation !== requestGeneration.current) return
      setEvents((current) =>
        mergeAgentEventRows(current, page.events, current.length + page.events.length)
      )
      setOlderCursor(page.nextCursor)
      setHasOlder(page.hasMore)
    } catch (error) {
      if (generation !== requestGeneration.current) return
      setHistoryError(error instanceof Error ? error.message : 'Unable to load older events')
    } finally {
      if (generation === requestGeneration.current) setLoadingHistory(false)
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
    } finally {
      setAllowingEvent('')
    }
  }

  if (!canRead)
    return <AgentAccessDenied subtitle="You do not have permission to view Agent runtime logs." />

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
                  { value: '', label: 'All Workflows' },
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
            <AgentBadge tone="green">
              {tailLoading ? 'Checking for events' : 'Live polling'}
            </AgentBadge>
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
                              connection && (
                                <AllowHostAction
                                  endpoint={endpoint}
                                  connection={connection}
                                  allowing={allowingEvent === key}
                                  disabled={!!allowingEvent}
                                  onConfirm={() => permanentlyAllowHost(event, connection)}
                                />
                              )
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

      {hasOlder && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-neutral-500/5 p-3">
          <p className="text-xs text-neutral-500">
            {events.length >= MAX_EVENT_ROWS
              ? `Showing the latest ${MAX_EVENT_ROWS.toLocaleString()} events. Narrow the filters to see older ones.`
              : 'Older events are available.'}
          </p>
          {events.length < MAX_EVENT_ROWS && (
            <Button
              type="button"
              variant="secondary"
              icon={FaHistory}
              onClick={loadOlder}
              isLoading={loadingHistory}
            >
              Load older events
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
