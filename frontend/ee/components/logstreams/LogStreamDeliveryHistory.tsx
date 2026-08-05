import { useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { Disclosure, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { FaChevronRight, FaRedo, FaSyncAlt } from 'react-icons/fa'
import { LogStreamDeliveryEventType, LogStreamType } from '@/apollo/graphql'
import { GetLogStreamDeliveries } from '@/graphql/queries/logstreams/getLogStreamDeliveries.gql'
import { RetryLogStreamDeliveryOp } from '@/graphql/mutations/logstreams/retryLogStreamDelivery.gql'
import { relativeTimeFromDates } from '@/utils/time'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
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
  onRetried: () => void
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
      onRetried()
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
              <FaChevronRight
                className={clsx(
                  'transform transition-all duration-300 text-xs',
                  open && 'rotate-90 text-emerald-500'
                )}
              />
            </td>

            <td className="whitespace-nowrap px-4 py-2">
              <div className="flex items-center gap-2">
                <DeliveryStatusIndicator status={event.status} showLabel />
                {isFailure && event.resolvedAt && (
                  <span className="text-2xs uppercase tracking-wider text-emerald-500">
                    Resolved
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
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation()
                    handleRetry()
                  }}
                  isLoading={retrying}
                  title="Re-ship this event range"
                >
                  <FaRedo /> Retry
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
                <div className="text-2xs font-mono border-b border-dashed border-neutral-500/20 pb-1 space-y-1">
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

                {isFailure && !event.resolvedAt && fullyExpired && (
                  <Alert variant="warning" size="sm" icon>
                    This range is older than the destination&apos;s {maxAgeHours}h
                    ingestion window and can no longer be retried — events would be
                    silently discarded.{' '}
                    {event.source === 'org_audit'
                      ? 'Use the audit logs REST API to export this range instead.'
                      : 'The events remain available in the Phase Console.'}
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
  const [offset, setOffset] = useState(0)

  const { data, loading, refetch } = useQuery(GetLogStreamDeliveries, {
    variables: {
      streamId: stream.id,
      limit: PAGE_SIZE,
      offset,
      status: statusFilter,
    },
    pollInterval: 10000,
    fetchPolicy: 'cache-and-network',
  })

  const events: LogStreamDeliveryEventType[] = data?.logStreamDeliveries?.events ?? []
  const count: number = data?.logStreamDeliveries?.count ?? 0

  const sourceNames: Record<string, string> = Object.fromEntries(
    (stream.sourceLags ?? []).map((lag) => [lag!.source, lag!.name])
  )

  // The refetch is usually near-instant — a brief spinner confirms the click
  // registered.
  const [refreshing, setRefreshing] = useState(false)
  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refetch()
    } finally {
      setRefreshing(false)
    }
  }

  const setFilter = (filter: string | null) => {
    setStatusFilter(filter)
    setOffset(0)
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
                  ? 'bg-emerald-400/10 ring-emerald-400/40 text-emerald-500'
                  : 'ring-neutral-500/40 text-neutral-500 hover:text-black dark:hover:text-white'
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {loading && <Spinner size="sm" />}
          <Button
            type="button"
            variant="secondary"
            onClick={handleRefresh}
            isLoading={refreshing}
            title="Refresh delivery events"
          >
            <FaSyncAlt /> Refresh
          </Button>
        </div>
      </div>

      {/* Cap the table height so the dialog never outgrows the viewport —
          older events are one page click away. */}
      <div className="max-h-[45vh] overflow-y-auto">
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
            {events.map((event) => (
              <DeliveryRow
                key={event.id}
                event={event}
                stream={stream}
                sourceNames={sourceNames}
                userCanRetry={userCanRetry}
                onRetried={() => refetch()}
              />
            ))}
          </tbody>
        </table>
      </div>

      {events.length === 0 && !loading && (
        <div className="text-center text-sm text-neutral-500 py-8">
          {statusFilter === 'unresolved'
            ? 'No unresolved deliveries — this stream is in sync.'
            : 'No deliveries yet.'}
        </div>
      )}

      {count > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <div>
            Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, count)} of ~{count}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={offset + PAGE_SIZE >= count}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
