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
import { FaCheck, FaChevronRight } from 'react-icons/fa'
import { FiChevronsDown } from 'react-icons/fi'
import { toast } from 'react-toastify'
import { GetAgentEvents } from '@/graphql/queries/agents/getAgentEvents.gql'
import { AllowAgentConnectionHostOp } from '@/graphql/mutations/agents/manageAgentAssets.gql'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { JsonBlock } from '@/components/common/JsonBlock'
import { relativeTimeFromDates } from '@/utils/time'
import { ConfirmAgentAction } from './AgentDialogs'
import { AgentFilterMenu, AgentFilterOption, AgentFilterSection } from './AgentFilterMenu'
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

  const { data: tailData, error: tailError } = useQuery(GetAgentEvents, {
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

  // A second click on the selected option clears it, as in the SCIM log filter.
  const toggleFilter = (key: 'workflowId' | 'proxyDecision', value: string) =>
    setFilters((current) => ({ ...current, [key]: current[key] === value ? '' : value }))

  const toggleEvent = (key: string) => setExpandedEvent((current) => (current === key ? '' : key))

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className="flex items-center gap-2 text-sm text-neutral-500"
          title="New events appear here automatically."
        >
          <span
            aria-hidden="true"
            className={clsx('size-2 rounded-full', tailError ? 'bg-amber-500' : 'bg-emerald-500')}
          />
          Live polling
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
                  <th className="px-4 py-2">Time</th>
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
                        <td
                          className="whitespace-nowrap px-4 py-2 text-xs font-medium capitalize"
                          title={formatAgentDate(event.proxyCreatedAt)}
                        >
                          {relativeTimeFromDates(new Date(event.proxyCreatedAt))}
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
                                <LogField label="Provider">{event.provider || 'Runtime'}</LogField>
                                <LogField label="Timestamp">
                                  {formatAgentDate(event.proxyCreatedAt)}
                                </LogField>
                                <LogField label="Ingested">
                                  {formatAgentDate(event.ingestedAt)}
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
            {!hasOlder ? (
              <span className="text-sm">No more events to show</span>
            ) : events.length >= MAX_EVENT_ROWS ? (
              <span className="text-sm">
                Showing the latest {MAX_EVENT_ROWS.toLocaleString()} events. Narrow the filters to
                see older ones.
              </span>
            ) : (
              <Button variant="secondary" onClick={loadOlder} isLoading={loadingHistory}>
                <FiChevronsDown /> Load more
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
