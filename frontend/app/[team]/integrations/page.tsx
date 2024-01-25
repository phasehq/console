'use client'

import { organisationContext } from '@/contexts/organisationContext'
import { Fragment, useContext, useEffect, useState } from 'react'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import GetOrganisationSyncs from '@/graphql/queries/syncing/GetOrgSyncs.gql'
import GetProviderList from '@/graphql/queries/syncing/getProviders.gql'
import { useLazyQuery, useQuery } from '@apollo/client'
import {
  AppType,
  EnvironmentSyncType,
  ProviderCredentialsType,
  ProviderType,
} from '@/apollo/graphql'
import { CreateProviderCredentialsDialog } from '@/components/syncing/CreateProviderCredentialsDialog'
import { SyncCard } from '@/components/syncing/SyncCard'
import { ProviderCredentialCard } from '@/components/syncing/ProviderCredentialCard'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { Button } from '@/components/common/Button'
import { Menu, Transition } from '@headlessui/react'
import { FaArrowRight, FaCubes, FaPlus } from 'react-icons/fa'
import clsx from 'clsx'
import Link from 'next/link'
import { userIsAdmin } from '@/utils/permissions'
import { useSearchParams } from 'next/navigation'
import { FrameworkIntegrations } from '@/components/syncing/FrameworkIntegrations'
import { ProviderCard } from '@/components/syncing/CreateProviderCredentials'
import { AppCard } from '@/components/apps/AppCard'

export default function Integrations({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const searchParams = useSearchParams()

  const openCreateCredentialDialog = searchParams.get('newCredential')

  const { data: providersData } = useQuery(GetProviderList)

  const providers: ProviderType[] = providersData?.providers ?? []

  const [provider, setProvider] = useState<ProviderType | null>(null)

  const [getApps, { data: appsData }] = useLazyQuery(GetApps)
  const [getSavedCredentials, { data: credentialsData }] = useLazyQuery(GetSavedCredentials)
  const [getOrgSyncs, { data: syncsData }] = useLazyQuery(GetOrganisationSyncs)

  useEffect(() => {
    if (organisation) {
      getSavedCredentials({ variables: { orgId: organisation.id }, pollInterval: 10000 })
      getOrgSyncs({ variables: { orgId: organisation.id }, pollInterval: 10000 })
      getApps({ variables: { organisationId: organisation.id } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisation])

  const apps = appsData?.apps ?? []

  const activeUserIsAdmin = organisation ? userIsAdmin(organisation.role!) : false

  const noCredentials = credentialsData?.savedCredentials.length === 0

  const noSyncs = syncsData?.syncs.length === 0

  const noApps = appsData?.apps.length === 0

  const NewSyncMenu = () => {
    return (
      <Menu as="div" className="relative group">
        {({ open }) => (
          <>
            <Menu.Button as={Fragment}>
              <Button type="button" variant="primary" title="Create a new snc">
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
                <div className="flex flex-col w-min divide-y divide-neutral-500/40 rounded-md bg-neutral-200 dark:bg-neutral-800 shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
                  {apps.map((app: AppType) => (
                    <Menu.Item key={app.id} as={Fragment}>
                      {({ active }) => (
                        <Link
                          href={`/${params.team}/apps/${app.id}/syncing?newSync=true`}
                          className={clsx(
                            'text-black dark:text-white px-4 py-2 flex items-center justify-between gap-4 rounded-md',
                            active && 'bg-zinc-200 dark:bg-zinc-700'
                          )}
                        >
                          <div className="text-lg whitespace-nowrap">{app.name}</div>
                          <FaArrowRight className="text-neutral-500" />
                        </Link>
                      )}
                    </Menu.Item>
                  ))}
                </div>
              </Menu.Items>
            </Transition>
          </>
        )}
      </Menu>
    )
  }

  return (
    <div className="w-full space-y-8 md:space-y-10 p-8 text-black dark:text-white">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold">{params.team} Integrations</h1>
        <p className="text-neutral-500">Manage integrations with third party services</p>
      </div>

      <div className="space-y-4">
        <div className="border-b border-neutral-500/20 pb-4">
          <h2 className="text-black dark:text-white text-xl font-medium">Syncs</h2>
          <p className="text-neutral-500">Manage syncs</p>
        </div>

        {!noSyncs && activeUserIsAdmin && (
          <div className="flex justify-end">
            <NewSyncMenu />
          </div>
        )}

        {noApps && (
          <div className="flex flex-col items-center text-center gap-4 p-16">
            <div>
              <div className="font-semibold text-black dark:text-white text-xl">No Apps</div>
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
            <div>
              <div className="font-semibold text-black dark:text-white text-xl">No syncs</div>
              <div className="text-neutral-500">
                You don&apos;t have any syncs at the moment. Choose an App below to create a sync.
              </div>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:max-w-none xl:grid-cols-4">
              {apps?.map((app: AppType) => (
                <Link href={`/${params.team}/apps/${app.id}/syncing`} key={app.id}>
                  <AppCard app={app} />
                </Link>
              ))}
            </div>
          </div>
        ) : (
          syncsData?.syncs.map((sync: EnvironmentSyncType) => (
            <SyncCard key={sync.id} sync={sync} showAppName={true} showManageButton={true} />
          ))
        )}
      </div>

      <hr className="border-neutral-500/40" />

      <div className="space-y-4">
        <div className="border-b border-neutral-500/20 pb-4">
          <h2 className="text-black dark:text-white text-xl font-medium">Service credentials</h2>
          <p className="text-neutral-500">Manage stored credentials for third party services</p>
        </div>

        <div
          className={clsx(
            noCredentials ? 'flex flex-col text-center gap-6 py-4' : 'flex justify-end'
          )}
        >
          {noCredentials && (
            <div>
              <div className="font-semibold text-black dark:text-white text-xl">
                No service credentials
              </div>
              <div className="text-neutral-500">
                {activeUserIsAdmin
                  ? 'Set up a new authentication method to start syncing with third party services.'
                  : 'Contact your organisation admin or owner to create credentials.'}
              </div>
            </div>
          )}

          {activeUserIsAdmin && (
            <>
              <div className="flex justify-end">
                <CreateProviderCredentialsDialog
                  showButton={!noCredentials}
                  provider={provider}
                  defaultOpen={openCreateCredentialDialog !== null}
                  closeDialogCallback={() => setProvider(null)}
                />
              </div>
              {noCredentials ? (
                <div className="">
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:max-w-none xl:grid-cols-4">
                    {providers.map((provider) => (
                      <button key={provider.id} type="button" onClick={() => setProvider(provider)}>
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

        {credentialsData?.savedCredentials.length > 0 &&
          credentialsData?.savedCredentials.map((credential: ProviderCredentialsType) => (
            <ProviderCredentialCard key={credential.id} credential={credential} />
          ))}
      </div>

      <hr className="border-neutral-500/40" />

      <div className="space-y-4">
        <div className="border-b border-neutral-500/20 pb-4">
          <h2 className="text-black dark:text-white text-xl font-medium"> Frameworks</h2>
          <p className="text-neutral-500">Integrate Phase with your application stack</p>
        </div>

        <FrameworkIntegrations />
      </div>
    </div>
  )
}
