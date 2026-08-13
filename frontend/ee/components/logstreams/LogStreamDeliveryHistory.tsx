import { Fragment, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { Disclosure, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { FaArrowRotateRight, FaChevronDown } from 'react-icons/fa6'
import { FaStream } from 'react-icons/fa'
import { FiChevronsDown } from 'react-icons/fi'
import { LogStreamDeliveryEventType, LogStreamSourceType, LogStreamType } from '@/apollo/graphql'
import { GetLogStreamDeliveries } from '@/graphql/queries/logstreams/getLogStreamDeliveries.gql'
import { GetLogStreamProviders } from '@/graphql/queries/logstreams/getLogStreamProviders.gql'
import { RetryLogStreamDeliveryOp } from '@/graphql/mutations/logstreams/retryLogStreamDelivery.gql'
import { relativeTimeFromDates } from '@/utils/time'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { DeliveryStatusIndicator } from './LogStreamStatusIndicator'

const PAGE_SIZE = 25

const FormattedJSON = (props: { jsonData: any }) => {
  const formatted =
    typeof props.jsonData === 'string'
      ? props.jsonData
      : JSON.stringify(props.jsonData ?? {}, null, 2)

  return (
    <div className="overflow-auto py-3">
      <code className="block whitespace-pre-wrap break-words text-2xs font-medium">
        <pre>{formatted}</pre>
      </code>
    </div>
  )
}

const DeliveryRow = (props: {
  event: LogStreamDeliveryEventType
  stream: LogStreamType
  sourceNames: Record<string, string>
  userCanRetry: boolean
  onRetried: () => Promise<void>
}) => {
  const { event, stream, sourceNames, userCanRetry, onRetried } = props

  const [retryDelivery, { loading: retrying }] = useMutation(RetryLogStreamDeliveryOp)

  const isFailure = event.status.toLowerCase() !== 'completed'

  // Ranges older than the destination's max event age get silently dropped
  // (Datadog 202s then discards). A fully-expired range is no longer
  // retryable — the backend rejects it; a partially-expired one ships the
  // live tail and records the expired head as skipped. The 40-minute margin
  // mirrors the backend's SKIP_AHEAD_MARGIN so the Retry button disappears
  // exactly when the backend starts rejecting.
  const SKIP_AHEAD_MARGIN_MS = 40 * 60 * 1000
  const maxAgeHours = stream.providerInfo?.maxEventAgeHours
  const windowMs = maxAgeHours ? maxAgeHours * 3600 * 1000 - SKIP_AHEAD_MARGIN_MS : null
  const fullyExpired =
    !!windowMs &&
    !!event.cursorTo &&
    Date.now() - new Date(event.cursorTo).getTime() > windowMs

  // Expired-resolved rows shipped nothing — never a green "Resolved".
  let expiredResolution = false
  try {
    const meta = typeof event.meta === 'string' ? JSON.parse(event.meta) : event.meta
    expiredResolution = meta?.resolution === 'expired'
  } catch {
    // unparseable meta — treat as a normal resolution
  }
  const partiallyExpired =
    !fullyExpired &&
    !!windowMs &&
    !!event.cursorFrom &&
    Date.now() - new Date(event.cursorFrom).getTime() > windowMs

  // Stream-level failures (e.g. missing credentials) have no event range to
  // re-ship, so they aren't retryable. Paused streams don't egress at all —
  // manual retries included.
  const retryable =
    isFailure &&
    !event.resolvedAt &&
    userCanRetry &&
    stream.isActive &&
    !!event.source &&
    !!event.cursorFrom &&
    !!event.cursorTo &&
    !fullyExpired

  const handleRetry = async () => {
    try {
      await retryDelivery({ variables: { deliveryEventId: event.id } })
      toast.info('Delivery retry queued')
      await onRetried()
    } catch (error: any) {
      toast.error(error.message || 'Could not queue the retry')
    }
  }

  return (
    <Disclosure>
      {({ open }) => (
        <>
          <Disclosure.Button
            as="tr"
            className={clsx(
              'py-2 border-neutral-500/20 transition duration-300 ease-in-out cursor-pointer text-sm text-black dark:text-white',
              open
                ? 'bg-neutral-200 dark:bg-neutral-800 border-r'
                : 'border-b hover:bg-neutral-200 dark:hover:bg-neutral-800'
            )}
          >
            <td
              className={clsx(
                'px-4 py-2 border-l',
                open ? 'border-l-emerald-500 ' : 'border-l-transparent'
              )}
            >
              <FaChevronDown
                className={clsx(
                  'transform transition-all duration-300 text-xs',
                  open && 'rotate-180 text-emerald-500'
                )}
              />
            </td>

            <td className="whitespace-nowrap px-4 py-2">
              <div className="flex items-center gap-2">
                <DeliveryStatusIndicator status={event.status} showLabel />
                {isFailure && event.resolvedAt && (
                  <span
                    className={clsx(
                      'text-2xs uppercase tracking-wider',
                      expiredResolution ? 'text-amber-500' : 'text-emerald-500'
                    )}
                  >
                    {expiredResolution ? 'Expired' : 'Resolved'}
                  </span>
                )}
              </div>
            </td>

            <td className="whitespace-nowrap px-4 py-2 text-xs">
              {sourceNames[event.source] || event.source}
            </td>

            <td className="whitespace-nowrap px-4 py-2 text-xs">{event.eventCount}</td>

            <td className="whitespace-nowrap px-4 py-2 text-xs">{event.attempts}</td>

            <td className="whitespace-nowrap px-4 py-2 text-xs">
              {relativeTimeFromDates(new Date(event.createdAt))}
            </td>

            <td className="whitespace-nowrap px-4 py-2 text-right">
              {retryable && (
                <Button
                  type="button"
                  variant="secondary"
                  icon={FaArrowRotateRight}
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation()
                    handleRetry()
                  }}
                  isLoading={retrying}
                  title="Re-ship this event range"
                >
                  Retry
                </Button>
              )}
            </td>
          </Disclosure.Button>
          <Transition
            as="tr"
            enter="transition duration-100 ease-out"
            enterFrom="transform scale-95 opacity-0"
            enterTo="transform scale-100 opacity-100"
            leave="transition duration-75 ease-out"
            leaveFrom="transform scale-100 opacity-100"
            leaveTo="transform scale-95 opacity-0"
          >
            <td
              colSpan={7}
              className={clsx(
                'p-3 w-full space-y-4 bg-neutral-200 dark:bg-neutral-800 border-neutral-500/20 text-black dark:text-white border-l',
                open ? 'border-b  border-l-emerald-500 border-r shadow-xl' : 'border-l-transparent'
              )}
            >
              <Disclosure.Panel>
                <div className="text-2xs font-mono border-b border-neutral-500/20 pb-1 space-y-1">
                  <div>
                    <span className="text-neutral-500">Delivery ID: </span>
                    <span className="font-semibold">{event.id}</span>
                  </div>
                  {event.cursorFrom && event.cursorTo && (
                    <div>
                      <span className="text-neutral-500">Event range: </span>
                      <span className="font-semibold">
                        {new Date(event.cursorFrom).toISOString()} —{' '}
                        {new Date(event.cursorTo).toISOString()}
                      </span>
                    </div>
                  )}
                </div>

                {isFailure && (expiredResolution || (!event.resolvedAt && fullyExpired)) && (
                  <Alert variant="warning" size="sm" icon>
                    This range is older than the destination&apos;s {maxAgeHours}h
                    ingestion window and can no longer be retried — events would be
                    silently discarded. The events remain available in the Phase
                    Console logs.
                  </Alert>
                )}

                {retryable && partiallyExpired && (
                  <Alert variant="warning" size="sm" icon>
                    Part of this range is older than the destination&apos;s{' '}
                    {maxAgeHours}h ingestion window. A retry ships the events still
                    inside the window and records the expired part as skipped.
                  </Alert>
                )}

                <FormattedJSON jsonData={event.meta} />
              </Disclosure.Panel>
            </td>
          </Transition>
        </>
      )}
    </Disclosure>
  )
}

export const LogStreamDeliveryHistory = (props: {
  stream: LogStreamType
  userCanRetry: boolean
  initialStatusFilter?: string
}) => {
  const { stream, userCanRetry, initialStatusFilter } = props

  const [statusFilter, setStatusFilter] = useState<string | null>(initialStatusFilter || null)

  // Load-more (accumulating) pagination like the secret logs page. Polling is
  // deliberately off: a poll re-runs the base query at offset 0 and would
  // collapse the accumulated list back to page one.
  const { data, loading, refetch, fetchMore } = useQuery(GetLogStreamDeliveries, {
    variables: {
      streamId: stream.id,
      limit: PAGE_SIZE,
      offset: 0,
      status: statusFilter,
    },
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  })

  // Registry names (cache-first — the settings tab's form runs the same
  // query). sourceLags only covers the stream's ACTIVE sources, so a
  // delivery row from a since-disabled source would fall back to its raw id
  // (e.g. 'secrets' instead of 'App secret logs') without the registry map.
  const { data: providersData } = useQuery(GetLogStreamProviders)

  const events: LogStreamDeliveryEventType[] = data?.logStreamDeliveries?.events ?? []
  const count: number = data?.logStreamDeliveries?.count ?? 0
  // `count` is a planner estimate above 10k rows, so also treat a short page
  // as the end.
  const [reachedEnd, setReachedEnd] = useState(false)
  const endOfList = reachedEnd || events.length >= count

  const sourceNames: Record<string, string> = Object.fromEntries([
    ...(providersData?.logStreamSources ?? []).map((source: LogStreamSourceType) => [
      source.id,
      source.name,
    ]),
    ...(stream.sourceLags ?? []).map((lag) => [lag!.source, lag!.name]),
  ])

  // Server-offset high-water mark: rows CONSUMED from the server, including
  // duplicates dropped by the dedupe below. The load-more offset must
  // advance by rows consumed, not rows displayed — deriving it from the
  // deduped list length would re-request the same offset forever once a
  // stale-offset page is entirely already-seen rows (each new delivery row
  // shifts seen rows down into later pages of the newest-first list).
  const rawFetchedRef = useRef(0)

  const [refreshing, setRefreshing] = useState(false)
  const handleRefresh = async () => {
    setRefreshing(true)
    rawFetchedRef.current = 0
    setReachedEnd(false)
    try {
      await refetch()
    } finally {
      setRefreshing(false)
    }
  }

  const [loadingMore, setLoadingMore] = useState(false)
  const loadMore = async () => {
    if (loadingMore || endOfList) return
    setLoadingMore(true)
    const offset = Math.max(events.length, rawFetchedRef.current)
    try {
      const result = await fetchMore({
        // limit is explicit: a refetch (after a retry) merges an enlarged
        // limit into the query variables, and fetchMore would inherit it —
        // breaking the short-page end check below.
        variables: { offset, limit: PAGE_SIZE },
        updateQuery: (prev, { fetchMoreResult }) => {
          const more = fetchMoreResult?.logStreamDeliveries?.events ?? []
          if (!more.length) return prev
          // Rows written between pages shift the offset window, so a page
          // can re-serve rows already in the list — dedupe by id (they're
          // also React keys).
          const seen = new Set(prev.logStreamDeliveries.events.map((e: any) => e.id))
          const fresh = more.filter((e: any) => !seen.has(e.id))
          return {
            ...prev,
            logStreamDeliveries: {
              ...prev.logStreamDeliveries,
              events: [...prev.logStreamDeliveries.events, ...fresh],
              count: fetchMoreResult.logStreamDeliveries.count,
            },
          }
        },
      })
      const rawPageSize = result.data?.logStreamDeliveries?.events?.length ?? 0
      rawFetchedRef.current = offset + rawPageSize
      if (rawPageSize < PAGE_SIZE) {
        setReachedEnd(true)
      }
    } finally {
      setLoadingMore(false)
    }
  }

  // Refresh the visible rows after a retry in one request. The backend caps
  // limit at 100, so beyond four pages the refresh truncates the accumulated
  // list to the first 100 rows — a bounded trade-off vs collapsing to page
  // one. loadMore passes its own limit explicitly, so the enlarged limit
  // merged into the query variables here never leaks into later pagination.
  const handleRetried = async () => {
    rawFetchedRef.current = 0
    setReachedEnd(false)
    try {
      await refetch({ offset: 0, limit: Math.min(Math.max(events.length, PAGE_SIZE), 100) })
    } catch {
      // The retry itself was queued; the list just didn't refresh.
    }
  }

  const setFilter = (filter: string | null) => {
    setStatusFilter(filter)
    rawFetchedRef.current = 0
    setReachedEnd(false)
  }

  const filters: { label: string; value: string | null }[] = [
    { label: 'All', value: null },
    { label: 'Out of sync', value: 'unresolved' },
    { label: 'Completed', value: 'completed' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {filters.map((filter) => (
            <button
              key={filter.label}
              type="button"
              onClick={() => setFilter(filter.value)}
              className={clsx(
                'px-2 py-1 rounded-md text-xs font-medium ring-1 ring-inset transition ease',
                statusFilter === filter.value
                  ? 'bg-emerald-400/10 ring-emerald-400/20 text-emerald-500'
                  : 'ring-neutral-400/20 text-neutral-500 hover:text-black dark:hover:text-white'
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            icon={FaArrowRotateRight}
            onClick={handleRefresh}
            isLoading={refreshing}
            title="Refresh delivery events"
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Fixed height so switching filters never shifts the dialog layout;
          clamped so it stays comfortably tall on short laptop screens. The
          list scrolls internally and pages in via Load more. */}
      <div className="h-[clamp(26rem,60vh,40rem)] overflow-y-auto rounded-md ring-1 ring-inset ring-neutral-500/10">
        {loading && events.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <Spinner size="md" />
          </div>
        ) : events.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              title={
                statusFilter === 'unresolved' ? 'No unresolved deliveries' : 'No deliveries yet'
              }
              subtitle={
                statusFilter === 'unresolved'
                  ? 'This stream is in sync — every delivery has been shipped or resolved.'
                  : 'Delivered chunks appear here as audit and secret events ship to the destination.'
              }
              graphic={
                <div className="text-neutral-300 dark:text-neutral-700 text-6xl text-center">
                  <FaStream />
                </div>
              }
            >
              <></>
            </EmptyState>
          </div>
        ) : (
          <table className="table-auto w-full text-left text-sm font-light">
            <thead className="sticky top-0 border-b-2 font-medium border-neutral-500/20 z-10 bg-neutral-300/50 dark:bg-neutral-900/60 backdrop-blur-lg shadow-xl">
              <tr className="text-neutral-500 text-2xs uppercase tracking-wider">
                <th></th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2">Events</th>
                <th className="px-4 py-2">Attempts</th>
                <th className="px-4 py-2">Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, n) => (
                <Fragment key={event.id}>
                  {n !== 0 && n % PAGE_SIZE === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <div className="flex items-center justify-center bg-zinc-300 dark:bg-zinc-800 py-0.5 text-neutral-500 text-2xs">
                          Page {n / PAGE_SIZE + 1}
                        </div>
                      </td>
                    </tr>
                  )}
                  <DeliveryRow
                    event={event}
                    stream={stream}
                    sourceNames={sourceNames}
                    userCanRetry={userCanRetry}
                    onRetried={handleRetried}
                  />
                </Fragment>
              ))}

              <tr>
                <td colSpan={7}>
                  <div className="flex justify-center px-4 py-4 text-xs text-neutral-500 font-medium">
                    {!endOfList ? (
                      <Button
                        type="button"
                        variant="secondary"
                        icon={FiChevronsDown}
                        onClick={loadMore}
                        isLoading={loadingMore}
                      >
                        Load more
                      </Button>
                    ) : (
                      `No${events.length ? ' more' : ''} deliveries to show`
                    )}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
