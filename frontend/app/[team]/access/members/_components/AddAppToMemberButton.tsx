'use client'

import { AppType, OrganisationMemberType, Query } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GetApps from '@/graphql/queries/getApps.gql'
import { Menu, Transition } from '@headlessui/react'
import { useQuery } from '@apollo/client'
import Link from 'next/link'
import { Fragment, useState } from 'react'
import { FaPlus, FaChevronDown, FaSearch, FaTimesCircle, FaArrowRight } from 'react-icons/fa'
import Spinner from '@/components/common/Spinner'
import clsx from 'clsx'
import { EmptyState } from '@/components/common/EmptyState'
import { MdSearchOff } from 'react-icons/md'

export const AddAppToMemberButton = (props: {
  member: OrganisationMemberType
  organisationId: string
  teamSlug: string
}) => {
  const { member, organisationId, teamSlug } = props
  const [searchQuery, setSearchQuery] = useState('')

  // Fetch all apps the active user has access to
  const { data: allAppsData, loading: loadingApps } = useQuery<Query>(GetApps, {
    variables: { organisationId },
    skip: !organisationId,
    fetchPolicy: 'cache-and-network',
  })

  // Get IDs of apps the member already has access to
  const memberAppIds = new Set(member.appMemberships?.map((app) => app.id) || [])

  // Filter out apps member already has access to
  const availableApps =
    allAppsData?.apps?.filter((app): app is AppType => app !== null && !memberAppIds.has(app.id)) ||
    []

  // Filter based on search query
  const filteredAvailableApps =
    searchQuery === ''
      ? availableApps
      : availableApps.filter((app: AppType) =>
          app?.name?.toLowerCase().includes(searchQuery.toLowerCase())
        ) || []

  return (
    <Menu as="div" className="relative inline-block text-left group">
      <Menu.Button as={Fragment}>
        <Button variant="primary" disabled={loadingApps}>
          {loadingApps ? (
            <Spinner size="sm" />
          ) : (
            <>
              <FaPlus className="mr-1" /> Add App
            </>
          )}
        </Button>
      </Menu.Button>
      <Transition
        as={Fragment}
        enter="transition duration-100 ease-out"
        enterFrom="transform scale-95 opacity-0"
        enterTo="transform scale-100 opacity-100"
        leave="transition duration-75 ease-out"
        leaveFrom="transform scale-100 opacity-100"
        leaveTo="transform scale-95 opacity-0"
      >
        <Menu.Items className="absolute z-10 right-0 origin-top-right mt-2 flex flex-col w-min divide-y divide-neutral-500/40 p-px rounded-md bg-neutral-200 dark:bg-neutral-800 shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
          <div>
            <div className="relative flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md px-2 w-full max-w-sm">
              <div className="">
                <FaSearch className="text-neutral-500" />
              </div>
              <input
                placeholder="Search Apps"
                className="custom bg-zinc-100 dark:bg-zinc-800"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
              <FaTimesCircle
                className={clsx(
                  'cursor-pointer text-neutral-500 transition-opacity ease absolute right-2',
                  searchQuery ? 'opacity-100' : 'opacity-0'
                )}
                role="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setSearchQuery('')
                }}
              />
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-neutral-500/20">
            {loadingApps ? (
              <div className="p-4">
                <Spinner size="sm" />
              </div>
            ) : filteredAvailableApps.length > 0 ? (
              filteredAvailableApps.map((app: AppType) => (
                <Menu.Item key={app.id}>
                  {({ active }) => (
                    <Link
                      href={`/${teamSlug}/apps/${app.id}/access/members?new=${member.id}`}
                      className={clsx(
                        'px-4 py-2 flex items-center justify-between gap-4 transition ease',
                        active
                          ? 'bg-zinc-200 dark:bg-zinc-700 text-emerald-500'
                          : 'text-zinc-900 dark:text-zinc-100'
                      )}
                      title={`Manage ${member.fullName || member.email}'s access for ${app.name}`}
                    >
                      <div className="text-sm whitespace-nowrap">{app.name}</div>
                      <FaArrowRight
                        className={clsx(active ? 'text-emerald-500' : 'text-neutral-500')}
                      />
                    </Link>
                  )}
                </Menu.Item>
              ))
            ) : searchQuery ? (
              <div className="p-4 w-64">
                <EmptyState
                  title={`No results for "${searchQuery}"`}
                  subtitle="Try adjusting your search term"
                  graphic={
                    <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                      <MdSearchOff />
                    </div>
                  }
                >
                  <></>
                </EmptyState>
              </div>
            ) : (
              <div className="p-4 text-center text-neutral-500 text-sm w-64">
                Member already has access to all available apps.
              </div>
            )}
          </div>
        </Menu.Items>
      </Transition>
    </Menu>
  )
}
