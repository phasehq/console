import { useContext, useState } from 'react'
import { useQuery } from '@apollo/client'
import { Menu, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import { FaPlus, FaArrowRight, FaSearch, FaTimesCircle } from 'react-icons/fa'
import Link from 'next/link'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { GetApps } from '@/graphql/queries/getApps.gql'
import Spinner from '@/components/common/Spinner'
import { AppMembershipType, AppType, Query } from '@/apollo/graphql'
import clsx from 'clsx'
import { EmptyState } from '@/components/common/EmptyState'
import { MdSearchOff } from 'react-icons/md'

interface AddAppButtonProps {
  serviceAccountId: string
  appMemberships: AppMembershipType[]
  align?: 'left' | 'right'
}

export const AddAppButton = ({
  serviceAccountId,
  appMemberships,
  align = 'left',
}: AddAppButtonProps) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [searchQuery, setSearchQuery] = useState('')

  const { data, loading } = useQuery<Query>(GetApps, {
    variables: { organisationId: organisation?.id },
    skip: !organisation,
    fetchPolicy: 'cache-and-network',
  })

  if (loading) return <Spinner size="sm" />

  const alignMenuRight = align === 'right'

  const apps: AppType[] =
    data?.apps?.filter(
      (app): app is AppType => !!app && !appMemberships.some((a) => a!.id === app.id)
    ) ?? []

  const filteredApps =
    searchQuery === ''
      ? apps
      : apps.filter((app: AppType) => app?.name?.toLowerCase().includes(searchQuery))

  return (
    <Menu as="div" className="relative group">
      {({ open }) => (
        <>
          <Menu.Button as={Fragment}>
            <Button variant="primary" title="Create a new sync">
              <FaPlus /> Add App
            </Button>
          </Menu.Button>
          <Transition
            enter="transition duration-100 ease-out"
            enterFrom="transform scale-95 opacity-0"
            enterTo="transform scale-100 opacity-100"
            leave="transition duration-75 ease-out"
            leaveFrom="transform scale-100 opacity-100"
            leaveTo="transform scale-95 opacity-0"
            as="div"
            className={clsx(
              'absolute z-10 mt-2',
              alignMenuRight ? 'origin-bottom-left left-0' : 'origin-bottom-right right-0'
            )}
          >
            <Menu.Items as={Fragment}>
              <div className="flex flex-col w-min divide-y divide-neutral-500/40 p-px rounded-md bg-neutral-200 dark:bg-neutral-800 shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
                <div>
                  <div className="relative flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md px-2 w-full max-w-sm">
                    <div className="">
                      <FaSearch className="text-neutral-500" />
                    </div>
                    <input
                      placeholder="Search"
                      className="custom bg-zinc-100 dark:bg-zinc-800"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <FaTimesCircle
                      className={clsx(
                        'cursor-pointer text-neutral-500 transition-opacity ease absolute right-2',
                        searchQuery ? 'opacity-100' : 'opacity-0'
                      )}
                      role="button"
                      onClick={() => setSearchQuery('')}
                    />
                  </div>
                </div>

                <div className="max-h-96 overflow-y-auto divide-y divide-neutral-500/20">
                  {filteredApps.map((app: AppType) => (
                    <Menu.Item key={app.id} as={Fragment}>
                      {({ active }) => (
                        <Link
                          href={`/${organisation?.name}/apps/${app.id}/access/service-accounts?new=${serviceAccountId}`}
                          className={clsx(
                            ' px-4 py-2 flex items-center justify-between gap-4 transition ease',
                            active
                              ? 'bg-zinc-200 dark:bg-zinc-700 text-emerald-500'
                              : 'text-zinc-900 dark:text-zinc-100'
                          )}
                        >
                          <div className="text-sm whitespace-nowrap">{app.name}</div>
                          <FaArrowRight
                            className={clsx(active ? 'text-emerald-500' : 'text-neutral-500')}
                          />
                        </Link>
                      )}
                    </Menu.Item>
                  ))}
                  {filteredApps.length === 0 && searchQuery && (
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
                  )}
                </div>
              </div>
            </Menu.Items>
          </Transition>
        </>
      )}
    </Menu>
  )
}
