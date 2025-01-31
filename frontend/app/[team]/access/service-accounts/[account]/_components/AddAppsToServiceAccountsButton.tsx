import { useContext } from 'react'
import { useQuery } from '@apollo/client'
import { Menu, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import { FaPlus, FaArrowRight } from 'react-icons/fa'
import Link from 'next/link'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { GetApps } from '@/graphql/queries/getApps.gql'
import Spinner from '@/components/common/Spinner'
import { AppType, Query } from '@/apollo/graphql'

interface Props {
  teamSlug: string;
  serviceAccountId: string;
}

export const AddAppButton = ({ teamSlug, serviceAccountId }: Props) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data, loading } = useQuery<Query>(GetApps, {
    variables: { organisationId: organisation?.id },
    skip: !organisation,
    fetchPolicy: 'cache-and-network',
  })

  if (loading) return <Spinner size="sm" />

  const apps = data?.apps?.filter((app): app is AppType => app !== null) || []

  return (
    <Menu as="div" className="relative group">
      {({ open }) => (
        <>
          <Menu.Button as={Fragment}>
            <Button variant="primary">
              <FaPlus/>
              Add App
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
            className="absolute z-10 right-0 origin-top-right mt-2"
          >
            <Menu.Items as={Fragment}>
              <div className="flex flex-col w-64 divide-y divide-neutral-500/40 rounded-md bg-neutral-200 dark:bg-neutral-800 shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
                {apps.length > 0 ? (
                  apps.map((app) => (
                    <Menu.Item key={app.id} as={Fragment}>
                      {({ active }) => (
                        <Link
                          href={`/${teamSlug}/apps/${app.id}/access/service-accounts?new=${serviceAccountId}`}
                          className={`text-zinc-900 dark:text-zinc-100 px-4 py-2 flex items-center justify-between gap-4 rounded-md ${
                            active ? 'bg-zinc-300 dark:bg-zinc-700' : ''
                          }`}
                        >
                          <div className="text-lg whitespace-nowrap truncate">{app.name}</div>
                          <FaArrowRight className="text-neutral-500 flex-shrink-0" />
                        </Link>
                      )}
                    </Menu.Item>
                  ))
                ) : (
                  <div className="px-4 py-2 text-sm text-neutral-500">No apps available</div>
                )}
              </div>
            </Menu.Items>
          </Transition>
        </>
      )}
    </Menu>
  )
}
