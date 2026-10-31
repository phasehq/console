'use client'

import {
  FormEvent,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useApolloClient, useMutation, useQuery } from '@apollo/client'
import clsx from 'clsx'
import { FaArrowDown, FaArrowUp, FaCheck, FaChevronRight } from 'react-icons/fa'
import { FiChevronsDown } from 'react-icons/fi'
import { toast } from 'react-toastify'
import { GetAgentEvents } from '@/graphql/queries/agents/getAgentEvents.gql'
import { AllowAgentConnectionHostOp } from '@/graphql/mutations/agents/manageAgentAssets.gql'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { JsonBlock } from '@/components/common/JsonBlock'
import { ConfirmAgentAction } from './AgentDialogs'
import { AgentFilterMenu, AgentFilterOption, AgentFilterSection } from './AgentFilterMenu'
import {
  AgentAccessDenied,
  AgentBadge,
  AgentEmpty,
  AgentLoading,
  AgentTime,
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

// The chevron, Time, Workflow, Request, Proxy decision, Status and action columns.
const COLUMN_COUNT = 7

const PROXY_DECISIONS = [
  { value: 'allow', label: 'Allow', color: 'text-emerald-500', tone: 'green' },
  { value: 'block', label: 'Block', color: 'text-red-500', tone: 'red' },
  { value: 'auth_deny', label: 'Authentication denied', color: 'text-amber-500', tone: 'amber' },
  { value: 'error', label: 'Error', color: 'text-red-500', tone: 'red' },
] as const

const proxyDecision = (value?: string | null) =>
  PROXY_DECISIONS.find((decision) => decision.value === value?.toLowerCase())

const LogField = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="space-y-0.5">
    <div className="text-2xs font-medium uppercase tracking-wider text-neutral-500">{label}</div>
    <div className="text-2xs md:text-xs font-medium font-mono">{children}</div>
  </div>
)

type EventPage = {
  events: AgentEventRow[]
  nextCursor: string
  hasMore: boolean
}

type EventOrder = 'newest' | 'oldest'

type EventFilters = {
  workflowId: string
  sessionUid: string
  proxyDecision: string
  provider: string
  range: string
  start: string
  end: string
}

const emptyFilters: EventFilters = {
  workflowId: '',
  sessionUid: '',
  proxyDecision: '',
  provider: '',
  range: '',
  start: '',
  end: '',
}

const TIME_RANGES = [
  { value: '1h', label: 'Last hour', hours: 1 },
  { value: '24h', label: 'Last 24h', hours: 24 },
  { value: '7d', label: 'Last 7d', hours: 24 * 7 },
  { value: '30d', label: 'Last 30d', hours: 24 * 30 },
  { value: 'custom', label: 'Custom', hours: 0 },
]

// datetime-local inputs hold local time without a zone.
const toLocalInput = (iso: string) => {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const fromLocalInput = (value: string) => {
  const date = new Date(value)
  return value && !Number.isNaN(date.valueOf()) ? date.toISOString() : ''
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
  workflows,
  sessions,
  canRead,
  canAllowHosts,
}: {
  organisationId: string
  agentId: string
  workflows: AgentEventWorkflow[]
  sessions: Array<{ sessionUid: string; workflow: { id: string; name: string } }>
  canRead: boolean
  canAllowHosts: boolean
}) {
  const client = useApolloClient()
  const requestGeneration = useRef(0)
  const [filters, setFilters] = useState<EventFilters>(emptyFilters)
  const [providerDraft, setProviderDraft] = useState('')
  const [order, setOrder] = useState<EventOrder>('newest')
  const [events, setEvents] = useState<AgentEventRow[]>([])
  // History pages by event time in the chosen order. The live tail polls for
  // newly ingested events, so it only runs while the newest are on top.
  const [liveCursor, setLiveCursor] = useState<string | null>(null)
  const [pageCursor, setPageCursor] = useState('')
  const [hasMore, setHasMore] = useState(false)
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
      start: filters.start || null,
      end: filters.end || null,
    }),
    [agentId, filters, organisationId]
  )

  const readHistory = useCallback(
    async (before?: string): Promise<EventPage> => {
      const result = await client.query({
        query: GetAgentEvents,
        variables: { ...baseVariables, order, before, limit: PAGE_SIZE },
        fetchPolicy: 'no-cache',
      })
      const page = result.data?.agentEvents
      return {
        events: (page?.events || []).filter(Boolean) as AgentEventRow[],
        nextCursor: page?.nextCursor || before || '',
        hasMore: !!page?.hasMore,
      }
    },
    [baseVariables, client, order]
  )

  useEffect(() => {
    const generation = ++requestGeneration.current
    setEvents([])
    setLiveCursor(null)
    setPageCursor('')
    setHasMore(false)
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
        setPageCursor(page.nextCursor)
        setHasMore(page.hasMore)
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

  const { data: tailData, error: tailError } = useQuery(GetAgentEvents, {
    variables: { ...baseVariables, cursor: liveCursor, limit: TAIL_PAGE_SIZE },
    skip: !canRead || liveCursor === null || order === 'oldest',
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
      setEvents((current) => {
        // A late batch can carry events older than the loaded window. History
        // pages bring those in at their place, so the tail skips them.
        const oldest = hasMore && current.length ? Date.parse(current[0].proxyCreatedAt) : -Infinity
        const inWindow = incoming.filter((event) => Date.parse(event.proxyCreatedAt) >= oldest)
        return mergeAgentEventRows(current, inWindow, Math.max(MAX_EVENT_ROWS, current.length))
      })
    if (page.nextCursor && page.nextCursor !== liveCursor) setLiveCursor(page.nextCursor)
  }, [hasMore, liveCursor, tailData])

  const loadMore = async () => {
    const generation = requestGeneration.current
    setLoadingHistory(true)
    setHistoryError('')
    try {
      const page = await readHistory(pageCursor)
      if (generation !== requestGeneration.current) return
      setEvents((current) =>
        mergeAgentEventRows(current, page.events, current.length + page.events.length)
      )
      setPageCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (error) {
      if (generation !== requestGeneration.current) return
      setHistoryError(error instanceof Error ? error.message : 'Unable to load more events')
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

  // A second click on the selected option clears it, as in the SCIM log filter.
  const toggleFilter = (key: 'workflowId' | 'proxyDecision', value: string) =>
    setFilters((current) => ({ ...current, [key]: current[key] === value ? '' : value }))

  const toggleEvent = (key: string) => setExpandedEvent((current) => (current === key ? '' : key))

  // Presets start from the moment they are picked; a second click clears them.
  const selectRange = (value: string) => {
    const preset = TIME_RANGES.find((range) => range.value === value)
    setFilters((current) =>
      current.range === value
        ? { ...current, range: '', start: '', end: '' }
        : {
            ...current,
            range: value,
            start: preset?.hours
              ? new Date(Date.now() - preset.hours * 3_600_000).toISOString()
              : '',
            end: '',
          }
    )
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

  const displayedEvents = order === 'newest' ? [...events].reverse() : events
  const filtersActive = Object.values(filters).some(Boolean)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className="flex items-center gap-2 text-sm text-neutral-500"
          title={
            order === 'oldest'
              ? 'Sort newest first to follow new events.'
              : 'New events appear here automatically.'
          }
        >
          <span
            aria-hidden="true"
            className={clsx(
              'size-2 rounded-full',
              order === 'oldest' ? 'bg-neutral-400' : tailError ? 'bg-amber-500' : 'bg-emerald-500'
            )}
          />
          {order === 'oldest' ? 'Live updates paused while sorted oldest first' : 'Live polling'}
        </span>
        <AgentFilterMenu title="Filter Agent events" active={filtersActive} onReset={clearFilters}>
          <AgentFilterSection title="Proxy decision">
            <div className="flex flex-wrap gap-2">
              {PROXY_DECISIONS.map((decision) => (
                <AgentFilterOption
                  key={decision.value}
                  selected={filters.proxyDecision === decision.value}
                  color={decision.color}
                  onClick={() => toggleFilter('proxyDecision', decision.value)}
                >
                  {decision.label}
                </AgentFilterOption>
              ))}
            </div>
          </AgentFilterSection>
          <AgentFilterSection title="Time range">
            <div className="flex flex-wrap gap-2">
              {TIME_RANGES.map((range) => (
                <AgentFilterOption
                  key={range.value}
                  selected={filters.range === range.value}
                  onClick={() => selectRange(range.value)}
                >
                  {range.label}
                </AgentFilterOption>
              ))}
            </div>
            {filters.range === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="datetime-local"
                  label="Start"
                  value={toLocalInput(filters.start)}
                  setValue={(value) =>
                    setFilters((current) => ({ ...current, start: fromLocalInput(value) }))
                  }
                />
                <Input
                  type="datetime-local"
                  label="End"
                  value={toLocalInput(filters.end)}
                  setValue={(value) =>
                    setFilters((current) => ({ ...current, end: fromLocalInput(value) }))
                  }
                />
              </div>
            )}
          </AgentFilterSection>
          {workflows.length > 0 && (
            <AgentFilterSection title="Workflow">
              <div className="flex flex-wrap gap-2">
                {workflows.map((workflow) => (
                  <AgentFilterOption
                    key={workflow.id}
                    selected={filters.workflowId === workflow.id}
                    onClick={() => toggleFilter('workflowId', workflow.id)}
                  >
                    {workflow.name}
                  </AgentFilterOption>
                ))}
              </div>
            </AgentFilterSection>
          )}
          {sessions.length > 0 && (
            <AgentFilterSection title="Session">
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
            </AgentFilterSection>
          )}
          <AgentFilterSection title="Provider">
            <form onSubmit={applyProviderFilter} className="flex items-center gap-2">
              <Input
                aria-label="Provider"
                value={providerDraft}
                setValue={setProviderDraft}
                placeholder="Exact provider, e.g. github"
              />
              <Button type="submit" variant="secondary">
                Apply
              </Button>
            </form>
          </AgentFilterSection>
        </AgentFilterMenu>
      </div>

      {(historyError || tailError) && (
        <div role="alert">
          <Alert variant="danger" icon size="sm">
            <span className="text-xs">{historyError || tailError?.message}</span>
          </Alert>
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
        <>
          <div className="overflow-x-auto">
            <table className="table-auto min-w-full text-left">
              <thead>
                <tr className="border-b border-neutral-500/20 text-2xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="w-6 py-2"></th>
                  <th
                    className="px-4 py-2"
                    aria-sort={order === 'newest' ? 'descending' : 'ascending'}
                  >
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-zinc-900 dark:hover:text-zinc-100"
                      title={order === 'newest' ? 'Sort oldest first' : 'Sort newest first'}
                      onClick={() => setOrder(order === 'newest' ? 'oldest' : 'newest')}
                    >
                      Time {order === 'newest' ? <FaArrowDown /> : <FaArrowUp />}
                    </button>
                  </th>
                  <th className="px-4 py-2">Workflow</th>
                  <th className="px-4 py-2">Request</th>
                  <th className="px-4 py-2">Proxy decision</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayedEvents.map((event) => {
                  const key = agentEventKey(event)
                  const expanded = expandedEvent === key
                  const connectionCandidates = blockedHostConnectionCandidates(event, workflows)
                  const connection = blockedHostConnectionCandidate(event, workflows)
                  const endpoint = agentEventAuthority(event)
                  const hostStatus = connection
                    ? allowedHosts[`${connection.id}:${endpoint.toLowerCase()}`]
                    : undefined
                  const decision = proxyDecision(event.proxyDecision)
                  return (
                    <Fragment key={key}>
                      <tr
                        className={clsx(
                          'cursor-pointer border-neutral-500/20 transition duration-300 ease-in-out',
                          expanded
                            ? 'bg-neutral-100 dark:bg-neutral-800 border-r'
                            : 'border-b hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        )}
                        onClick={() => toggleEvent(key)}
                      >
                        <td
                          className={clsx(
                            'px-2 py-2 border-l',
                            expanded ? 'border-l-emerald-500' : 'border-l-transparent'
                          )}
                        >
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? 'Hide' : 'Show'} details for event ${event.eventId}`}
                            className="flex rounded p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                            onClick={(clickEvent) => {
                              clickEvent.stopPropagation()
                              toggleEvent(key)
                            }}
                          >
                            <FaChevronRight
                              className={clsx(
                                'transform transition-all duration-300 text-xs',
                                expanded && 'rotate-90 text-emerald-500'
                              )}
                            />
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-xs font-medium capitalize">
                          <AgentTime value={event.proxyCreatedAt} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-xs">
                          {event.workflow?.name || 'Unknown workflow'}
                        </td>
                        <td className="max-w-xs px-4 py-2 text-xs">
                          <div className="truncate" title={`${endpoint}${event.path || ''}`}>
                            <span className="font-medium">
                              {event.method || humanizeAgentValue(event.eventType)}
                            </span>{' '}
                            {endpoint || 'Runtime'}
                            {event.path || ''}
                          </div>
                          <div className="text-2xs text-neutral-500">
                            {event.connection?.name ||
                              (connection ? `Target: ${connection.name}` : 'No connection')}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2">
                          <AgentBadge tone={decision?.tone ?? 'neutral'}>
                            {decision?.label ?? humanizeAgentValue(event.proxyDecision)}
                          </AgentBadge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-xs text-neutral-500">
                          {event.statusCode == null
                            ? event.outcome || 'No status'
                            : `HTTP ${event.statusCode}`}
                          <div className="text-2xs">
                            {event.latencyMs == null ? 'Latency unknown' : `${event.latencyMs} ms`}
                          </div>
                        </td>
                        {/* Stops row toggles, including clicks in the portalled confirmation dialog. */}
                        <td
                          className="px-4 py-2 text-right"
                          onClick={(clickEvent) => clickEvent.stopPropagation()}
                        >
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
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td
                            colSpan={COLUMN_COUNT}
                            className="border-b border-l border-r border-neutral-500/20 border-l-emerald-500"
                          >
                            <div className="w-full space-y-4 bg-neutral-100 p-4 shadow-xl dark:bg-neutral-800">
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                <LogField label="Event ID">
                                  <span className="break-all">{event.eventId}</span>
                                </LogField>
                                <LogField label="Session">
                                  <span className="break-all">
                                    {event.session?.sessionUid || 'Unavailable'}
                                  </span>
                                </LogField>
                                <LogField label="Provider">
                                  {event.provider ? humanizeAgentValue(event.provider) : 'Runtime'}
                                </LogField>
                                <LogField label="Timestamp">
                                  <AgentTime value={event.proxyCreatedAt} />
                                </LogField>
                                <LogField label="Ingested">
                                  <AgentTime value={event.ingestedAt} />
                                </LogField>
                                <LogField label="Protocol">{event.protocol}</LogField>
                                <LogField label="Outcome">{event.outcome || 'Unknown'}</LogField>
                                <LogField label="Bytes in / out">
                                  {event.bytesIn ?? 0} / {event.bytesOut ?? 0}
                                </LogField>
                                <LogField label="Credential action">
                                  {humanizeAgentValue(event.credentialAction)}
                                </LogField>
                                <div className="md:col-span-3">
                                  <LogField label="Reason">
                                    <span className="whitespace-pre-wrap">
                                      {event.reason || 'No reason recorded'}
                                    </span>
                                  </LogField>
                                </div>
                              </div>
                              <div className="space-y-2">
                                <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                                  Redacted detail
                                </h4>
                                <JsonBlock data={event.detail || {}} />
                              </div>
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

          <div className="flex justify-center px-6 py-4 text-neutral-500 font-medium">
            {!hasMore ? (
              <span className="text-sm">No more events to show</span>
            ) : events.length >= MAX_EVENT_ROWS ? (
              <span className="text-sm">
                {order === 'newest'
                  ? `Showing the latest ${MAX_EVENT_ROWS.toLocaleString()} events. Narrow the filters to see older ones.`
                  : `Showing the earliest ${MAX_EVENT_ROWS.toLocaleString()} events. Narrow the filters to see later ones.`}
              </span>
            ) : (
              <Button variant="secondary" onClick={loadMore} isLoading={loadingHistory}>
                <FiChevronsDown /> Load more
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
