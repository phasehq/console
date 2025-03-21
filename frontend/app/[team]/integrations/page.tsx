'use client'

import { organisationContext } from '@/contexts/organisationContext'
import { Fragment, useContext, useState, useEffect } from 'react'
import GetOrganisationSyncs from '@/graphql/queries/syncing/GetOrgSyncs.gql'
import GetProviderList from '@/graphql/queries/syncing/getProviders.gql'
import { useQuery } from '@apollo/client'
import {
  AppType,
  EnvironmentSyncType,
  ProviderCredentialsType,
  ProviderType,
} from '@/apollo/graphql'
import { CreateProviderCredentialsDialog } from '@/components/syncing/CreateProviderCredentialsDialog'
import { SyncCard } from '@/components/syncing/SyncCard'
import { ProviderCredentialCard } from '@/components/syncing/ProviderCredentialCard'
import { Button } from '@/components/common/Button'
import { Menu, Tab, Transition } from '@headlessui/react'
import { FaArrowRight, FaBan, FaCubes, FaPlus, FaSearch, FaTimesCircle } from 'react-icons/fa'
import clsx from 'clsx'
import Link from 'next/link'
import { userHasPermission } from '@/utils/access/permissions'
import { useRouter, useSearchParams } from 'next/navigation'
import { ProviderCard } from '@/components/syncing/CreateProviderCredentials'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { AppsView } from '@/components/apps/AppsView'
import { MdSearchOff } from 'react-icons/md'

export default function Integrations({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  // permissions
  const userCanReadIntegrationCredentials = organisation
    ? userHasPermission(organisation.role?.permissions, 'IntegrationCredentials', 'read')
    : false

  const userCanCreateIntegrationsCredentials = organisation
    ? userHasPermission(organisation.role?.permissions, 'IntegrationCredentials', 'create')
    : false

  const userCanReadIntegrations = organisation
    ? userHasPermission(organisation.role?.permissions, 'Integrations', 'read', true)
    : false

  const userCanCreateIntegrations = organisation
    ? userHasPermission(organisation.role?.permissions, 'Integrations', 'read', true)
    : false
  const userCanReadApps = organisation
    ? userHasPermission(organisation.role?.permissions, 'Apps', 'read')
    : false

  const router = useRouter()
  const searchParams = useSearchParams()
  const providerFromUrl = searchParams?.get('provider')
  const { data: providersData } = useQuery(GetProviderList)
  const providers: ProviderType[] = providersData?.providers ?? []
  const [provider, setProvider] = useState<ProviderType | null>(null)

  // Simplified useEffect that only handles provider param
  useEffect(() => {
    if (providerFromUrl && providers.length > 0) {
      const matchingProvider = providers.find(
        (p) => p.id.toLowerCase() === providerFromUrl.toLowerCase()
      )
      if (matchingProvider) {
        setProvider(matchingProvider)
      }
    }
  }, [providerFromUrl, providers])

  const { data, loading } = useQuery(GetOrganisationSyncs, {
    variables: { orgId: organisation?.id },
    pollInterval: 10000,
    skip:
      !organisation ||
      (!userCanReadIntegrationCredentials && !userCanReadIntegrations && !userCanReadApps),
    fetchPolicy: 'cache-and-network',
    nextFetchPolicy: 'cache-and-network',
  })

  const apps = data?.apps ?? []

  const noCredentials = data?.savedCredentials.length === 0

  const noSyncs = data?.syncs.length === 0

  const noApps = data?.apps.length === 0

  const NewSyncMenu = () => {
    const [searchQuery, setSearchQuery] = useState('')
    const filteredApps =
      searchQuery === ''
        ? apps
        : apps.filter((app: AppType) => app?.name?.toLowerCase().includes(searchQuery))
    return (
      <Menu as="div" className="relative group">
        {({ open }) => (
          <>
            <Menu.Button as={Fragment}>
              <Button type="button" variant="primary" title="Create a new sync">
                <FaPlus /> Create a sync
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
              className="absolute z-10 right-0 origin-bottom-right mt-2"
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
                            href={`/${params.team}/apps/${app.id}/syncing?newSync=true`}
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

  const closeDialog = () => {
    setProvider(null)
    router.replace(`/${params.team}/integrations`)
  }

  if (loading)
    return (
      <div className="w-full flex items-center justify-center py-40">
        <Spinner size="md" />
      </div>
    )

  return (
    <div className="w-full space-y-8 md:space-y-10 p-8 text-black dark:text-white">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold">{params.team} Integrations</h1>
        <p className="text-neutral-500">Manage integrations with third party services</p>
      </div>

      <Tab.Group>
        <Tab.List className="flex gap-4 w-full border-b border-neutral-500/20">
          <Tab as={Fragment}>
            {({ selected }) => (
              <div
                className={clsx(
                  'p-3 font-medium border-b focus:outline-none text-black dark:text-white',
                  selected
                    ? 'border-emerald-500 font-semibold text-emerald-500'
                    : ' border-transparent cursor-pointer'
                )}
              >
                Syncs
              </div>
            )}
          </Tab>
          <Tab as={Fragment}>
            {({ selected }) => (
              <div
                className={clsx(
                  'p-3 font-medium border-b focus:outline-none text-black dark:text-white',
                  selected
                    ? 'border-emerald-500 font-semibold'
                    : ' border-transparent cursor-pointer'
                )}
              >
                Credentials
              </div>
            )}
          </Tab>
        </Tab.List>
        <Tab.Panels>
          <Tab.Panel>
            {userCanReadIntegrations ? (
              <div className="space-y-4">
                <div className="border-b border-neutral-500/20 pb-4">
                  <h2 className="text-black dark:text-white text-xl font-medium">Syncs</h2>
                  <p className="text-neutral-500">Manage syncs</p>
                </div>

                {!noSyncs && userCanCreateIntegrations && (
                  <div className="flex justify-end">
                    <NewSyncMenu />
                  </div>
                )}

                {noApps && (
                  <div className="flex flex-col items-center text-center gap-4 p-16">
                    <div>
                      <div className="font-semibold text-black dark:text-white text-xl">
                        No Apps
                      </div>
                      <div className="text-neutral-500">
                        You don&apos;t have access to any Apps. Create a new app, or contact your
                        organistion admin for access to start syncing.
                      </div>
                    </div>
                    <Link href={`/${params.team}/apps`}>
                      <Button variant="primary">
                        <FaCubes /> Go to Apps
                      </Button>
                    </Link>
                  </div>
                )}

                {noSyncs && !noApps ? (
                  <div className="flex flex-col text-center py-4 gap-6">
                    <EmptyState
                      title="No syncs"
                      subtitle="You don't have any syncs at the moment. Choose an App below to create a sync."
                    >
                      <></>
                    </EmptyState>

                    {apps && (
                      <div>
                        <AppsView apps={apps} tabToLink={'syncing'} />
                      </div>
                    )}
                  </div>
                ) : (
                  data?.syncs.map((sync: EnvironmentSyncType) => (
                    <SyncCard
                      key={sync.id}
                      sync={sync}
                      showAppName={true}
                      showManageButton={true}
                    />
                  ))
                )}
              </div>
            ) : (
              <EmptyState
                title="Access restricted"
                subtitle="You don't have the permissions required to view integrations in this organisation."
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                    <FaBan />
                  </div>
                }
              >
                <></>
              </EmptyState>
            )}
          </Tab.Panel>
          <Tab.Panel>
            {userCanReadIntegrationCredentials ? (
              <div className="space-y-4">
                <div className="border-b border-neutral-500/20 pb-4">
                  <h2 className="text-black dark:text-white text-xl font-medium">
                    Integration credentials
                  </h2>
                  <p className="text-neutral-500">
                    Manage stored credentials for third party services
                  </p>
                </div>

                <div
                  className={clsx(
                    noCredentials ? 'flex flex-col text-center gap-6 py-4' : 'flex justify-end'
                  )}
                >
                  {noCredentials && (
                    <div>
                      <div className="font-semibold text-black dark:text-white text-xl">
                        No integration credentials
                      </div>
                      <div className="text-neutral-500">
                        {userCanCreateIntegrationsCredentials
                          ? 'Set up a new authentication method to start syncing with third party services.'
                          : 'Contact your organisation admin or owner to create credentials.'}
                      </div>
                    </div>
                  )}

                  {userCanCreateIntegrationsCredentials && (
                    <>
                      <div className="flex justify-end">
                        <CreateProviderCredentialsDialog
                          showButton={!noCredentials}
                          provider={provider}
                          defaultOpen={!!provider}
                          closeDialogCallback={closeDialog}
                          key={provider?.id}
                        />
                      </div>
                      {noCredentials ? (
                        <div className="">
                          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:max-w-none xl:grid-cols-4">
                            {providers.map((provider) => (
                              <button
                                key={provider.id}
                                type="button"
                                onClick={() => setProvider(provider)}
                              >
                                <ProviderCard provider={provider} />
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className={clsx(noCredentials && 'flex justify-center p-4')}></div>
                      )}
                    </>
                  )}
                </div>

                {data?.savedCredentials.length > 0 &&
                  data?.savedCredentials.map((credential: ProviderCredentialsType) => (
                    <ProviderCredentialCard key={credential.id} credential={credential} />
                  ))}
              </div>
            ) : (
              <EmptyState
                title="Access restricted"
                subtitle="You don't have the permissions required to view integration credentials in this organisation."
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                    <FaBan />
                  </div>
                }
              >
                <></>
              </EmptyState>
            )}
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  )
}
