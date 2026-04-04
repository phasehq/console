'use client'

import { Fragment, useContext, useState } from 'react'
import { NetworkStatus, useQuery } from '@apollo/client'
import { FaBan, FaCheckCircle, FaCircle, FaFilter } from 'react-icons/fa'
import { FiRefreshCw, FiChevronsDown } from 'react-icons/fi'
import { FaArrowRotateLeft } from 'react-icons/fa6'
import { Menu, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { organisationContext } from '@/contexts/organisationContext'
import { GetSCIMEvents } from '@/graphql/queries/scim/getSCIMEvents.gql'
import { GetSCIMTokens } from '@/graphql/queries/scim/getSCIMTokens.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { dateToUnixTimestamp } from '@/utils/time'
import Spinner from '@/components/common/Spinner'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/common/Button'
import { SCIMEventsTable } from '../_components/SCIMEventsTable'
import { EVENT_TYPE_LABELS, getProviderIcon } from '../_components/shared'

const PAGE_SIZE = 25

const STATUS_OPTIONS = [
  { code: 'SUCCESS', label: 'Success', color: 'emerald' },
  { code: 'ERROR', label: 'Error', color: 'red' },
] as const

const filterCategoryTitleStyle =
  'text-[11px] font-semibold text-neutral-500 tracking-widest uppercase'

export default function SCIMLogsPage({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [eventTypes, setEventTypes] = useState<string[]>([])
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null)

  const userCanReadSCIM = organisation
    ? userHasPermission(organisation.role!.permissions, 'SCIM', 'read')
    : false

  const { data: tokensData } = useQuery(GetSCIMTokens, {
    variables: { organisationId: organisation?.id },
    skip: !organisation || !userCanReadSCIM,
  })

  const { data, loading, fetchMore, refetch, networkStatus } = useQuery(GetSCIMEvents, {
    variables: {
      organisationId: organisation?.id,
      eventTypes: eventTypes.length > 0 ? eventTypes : undefined,
      tokenId: selectedTokenId || undefined,
      status: selectedStatus || undefined,
    },
    skip: !organisation || !userCanReadSCIM,
    fetchPolicy: 'network-only',
    notifyOnNetworkStatusChange: true,
  })

  const isRefetching = networkStatus === NetworkStatus.refetch || loading
  const isFetchingMore = networkStatus === NetworkStatus.fetchMore

  const tokens = tokensData?.scimTokens || []
  const events = data?.scimEvents?.events || []
  const totalCount = data?.scimEvents?.count || 0
  const endOfList = events.length >= totalCount

  const hasActiveFilters =
    eventTypes.length > 0 || selectedTokenId !== null || selectedStatus !== null

  const clearFilters = () => {
    setEventTypes([])
    setSelectedTokenId(null)
    setSelectedStatus(null)
  }

  const getLastEventTimestamp = () =>
    events.length > 0 ? dateToUnixTimestamp(events[events.length - 1].timestamp) : Date.now()

  const loadMore = () => {
    if (loading || isFetchingMore) return

    const lastTs = getLastEventTimestamp()

    fetchMore({
      variables: { end: lastTs },
      updateQuery: (prev: any, { fetchMoreResult }: any) => {
        if (!fetchMoreResult?.scimEvents?.events?.length) {
          return prev
        }

        return {
          ...prev,
          scimEvents: {
            ...prev.scimEvents,
            events: [...prev.scimEvents.events, ...fetchMoreResult.scimEvents.events],
            count: prev.scimEvents.count,
          },
        }
      },
    })
  }

  const handleRefetch = async () => {
    await refetch({
      organisationId: organisation?.id,
      eventTypes: eventTypes.length > 0 ? eventTypes : undefined,
      tokenId: selectedTokenId || undefined,
      status: selectedStatus || undefined,
    })
  }

  if (!organisation)
    return (
      <div className="flex items-center justify-center p-10">
        <Spinner size="md" />
      </div>
    )

  if (!userCanReadSCIM)
    return (
      <section className="px-3 sm:px-4 lg:px-6">
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to view SCIM logs."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaBan />
            </div>
          }
        >
          <></>
        </EmptyState>
      </section>
    )

  return (
    <section className="px-3 sm:px-4 lg:px-6">
      <div className="w-full space-y-4 text-zinc-900 dark:text-zinc-100">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium">Provisioning Logs</h2>
            <p className="text-neutral-500 text-sm">{totalCount} Events</p>
          </div>

          <div className="flex items-center gap-2">
            {/* Filter popover */}
            <Menu as="div" className="relative inline-block text-left">
              {({ open }) => (
                <>
                  <div className="relative">
                    <Menu.Button as={Fragment}>
                      <div className="relative">
                        <Button variant="secondary" title="Filter logs">
                          <FaFilter /> Filter
                        </Button>
                        {hasActiveFilters && (
                          <span className="absolute -top-0 -right-0 h-2 w-2 rounded-full bg-emerald-500" />
                        )}
                      </div>
                    </Menu.Button>
                  </div>

                  <Transition
                    as={Fragment}
                    enter="transition duration-100 ease-out"
                    enterFrom="transform scale-95 opacity-0"
                    enterTo="transform scale-100 opacity-100"
                    leave="transition duration-75 ease-out"
                    leaveFrom="transform scale-100 opacity-100"
                    leaveTo="transform scale-95 opacity-0"
                  >
                    <Menu.Items
                      static
                      className="absolute right-0 mt-2 z-30 w-96 p-4 rounded-md shadow-xl bg-neutral-300/50 dark:bg-neutral-900/60 backdrop-blur-lg ring-1 ring-neutral-500/20 space-y-6"
                    >
                      {/* Status */}
                      <div className="space-y-2">
                        <div className={filterCategoryTitleStyle}>Status</div>
                        <div className="flex flex-wrap gap-2">
                          {STATUS_OPTIONS.map((opt) => (
                            <Button
                              key={opt.code}
                              type="button"
                              variant={selectedStatus === opt.code ? 'primary' : 'secondary'}
                              onClick={() =>
                                setSelectedStatus((prev) =>
                                  prev === opt.code ? null : opt.code
                                )
                              }
                            >
                              <span
                                className={clsx(
                                  'text-2xs',
                                  {
                                    emerald: 'text-emerald-500',
                                    red: 'text-red-500',
                                  }[opt.color]
                                )}
                              >
                                {selectedStatus === opt.code ? (
                                  <FaCheckCircle />
                                ) : (
                                  <FaCircle />
                                )}
                              </span>{' '}
                              <span className="text-xs">{opt.label}</span>
                            </Button>
                          ))}
                        </div>
                      </div>

                      {/* Event types */}
                      <div className="space-y-2">
                        <div className={filterCategoryTitleStyle}>Event Type</div>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(EVENT_TYPE_LABELS).map(([key, meta]) => (
                            <Button
                              key={key}
                              type="button"
                              variant={eventTypes.includes(key) ? 'primary' : 'secondary'}
                              onClick={() =>
                                setEventTypes((prev) =>
                                  prev.includes(key)
                                    ? prev.filter((t) => t !== key)
                                    : [...prev, key]
                                )
                              }
                            >
                              <span
                                className={clsx(
                                  'text-2xs',
                                  meta.color.split(' ')[0] // e.g. "text-emerald-500"
                                )}
                              >
                                {eventTypes.includes(key) ? <FaCheckCircle /> : <FaCircle />}
                              </span>{' '}
                              <span className="text-xs">{meta.label}</span>
                            </Button>
                          ))}
                        </div>
                      </div>

                      {/* Provider */}
                      {tokens.length > 0 && (
                        <div className="space-y-2">
                          <div className={filterCategoryTitleStyle}>Provider</div>
                          <div className="flex flex-wrap gap-2">
                            {tokens.map((token: any) => (
                              <Button
                                key={token.id}
                                type="button"
                                variant={
                                  selectedTokenId === token.id ? 'primary' : 'secondary'
                                }
                                icon={getProviderIcon(token.name)}
                                onClick={() =>
                                  setSelectedTokenId((prev) =>
                                    prev === token.id ? null : token.id
                                  )
                                }
                              >
                                <span className="text-xs">{token.name}</span>
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex justify-end pt-2">
                        <Button
                          variant="outline"
                          disabled={!hasActiveFilters}
                          onClick={clearFilters}
                        >
                          <FaArrowRotateLeft /> Reset filter
                        </Button>
                      </div>
                    </Menu.Items>
                  </Transition>
                </>
              )}
            </Menu>

            {/* Refresh */}
            <Button variant="secondary" onClick={handleRefetch} disabled={isRefetching}>
              <FiRefreshCw
                size={20}
                className={clsx('mr-1', isRefetching ? 'animate-spin' : '')}
              />{' '}
              Refresh
            </Button>
          </div>
        </div>

        {loading && events.length === 0 ? (
          <div className="flex items-center justify-center p-10">
            <Spinner size="md" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-8 text-neutral-500 text-sm">
            No provisioning events found.
          </div>
        ) : (
          <>
            <SCIMEventsTable events={events} pageSize={PAGE_SIZE} />

            <div className="flex justify-center px-6 py-4 text-neutral-500 font-medium">
              {!endOfList ? (
                <Button
                  variant="secondary"
                  onClick={loadMore}
                  disabled={isFetchingMore || endOfList}
                >
                  <FiChevronsDown /> Load more
                </Button>
              ) : (
                <span className="text-sm">
                  {events.length ? 'No more' : 'No'} events to show
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
