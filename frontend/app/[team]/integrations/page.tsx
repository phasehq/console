'use client'

import { organisationContext } from '@/contexts/organisationContext'
import { Fragment, useContext, useEffect } from 'react'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import GetOrganisationSyncs from '@/graphql/queries/syncing/GetOrgSyncs.gql'
import { useLazyQuery } from '@apollo/client'
import { AppType, EnvironmentSyncType, ProviderCredentialsType } from '@/apollo/graphql'
import { CreateProviderCredentialsDialog } from '@/components/syncing/CreateProviderCredentialsDialog'
import { SyncCard } from '@/components/syncing/SyncCard'
import { ProviderCredentialCard } from '@/components/syncing/ProviderCredentialCard'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { Button } from '@/components/common/Button'
import { SyncOptions } from '@/components/syncing/SyncOptions'
import { Menu, Transition } from '@headlessui/react'
import { FaArrowRight, FaPlus } from 'react-icons/fa'
import clsx from 'clsx'
import Link from 'next/link'
import { userIsAdmin } from '@/utils/permissions'
import { useSearchParams } from 'next/navigation'
import { FrameworkIntegrations } from '@/components/syncing/FrameworkIntegrations'

export default function Integrations({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const searchParams = useSearchParams()

  const openCreateCredentialDialog = searchParams.get('newCredential')

  const [getApps, { data: appsData }] = useLazyQuery(GetApps)
  const [getSavedCredentials, { data: credentialsData }] = useLazyQuery(GetSavedCredentials)
  const [getOrgSyncs, { data: syncsData }] = useLazyQuery(GetOrganisationSyncs)

  useEffect(() => {
    if (organisation) {
      getSavedCredentials({ variables: { orgId: organisation.id }, pollInterval: 10000 })
      getOrgSyncs({ variables: { orgId: organisation.id }, pollInterval: 10000 })
      getApps({ variables: { organisationId: organisation.id, appId: '' } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisation])

  const apps = appsData?.apps ?? []

  const activeUserIsAdmin = organisation ? userIsAdmin(organisation.role!) : false

  const noCredentials = credentialsData?.savedCredentials.length === 0

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

        {syncsData?.syncs.length > 0 && activeUserIsAdmin && (
          <div className="flex justify-end">
            <NewSyncMenu />
          </div>
        )}

        {syncsData?.syncs.length > 0 ? (
          syncsData?.syncs.map((sync: EnvironmentSyncType) => (
            <SyncCard key={sync.id} sync={sync} showAppName={true} showManageButton={true} />
          ))
        ) : (
          <div className="flex flex-col items-center text-center p-16">
            <div className="font-semibold text-black dark:text-white text-xl">No syncs</div>
            <div className="text-neutral-500">
              Create a sync from the &quot;Syncing&quot; tab of an App
            </div>
            {activeUserIsAdmin && (
              <div className="flex justify-center p-4">
                <NewSyncMenu />
              </div>
            )}
          </div>
        )}
      </div>

      <hr className="border-neutral-500/40" />

      <div className="space-y-4">
        <div className="border-b border-neutral-500/20 pb-4">
          <h2 className="text-black dark:text-white text-xl font-medium"> Authentication</h2>
          <p className="text-neutral-500">Manage stored credentials for third party services</p>
        </div>

        <div
          className={clsx(
            noCredentials ? 'flex flex-col items-center text-center p-16' : 'flex justify-end'
          )}
        >
          {noCredentials && (
            <div className="font-semibold text-black dark:text-white text-xl">
              No authentication credentials
            </div>
          )}
          {noCredentials && (
            <div className="text-neutral-500">
              Set up a new authentication method to start syncing with third party services.
            </div>
          )}
          {activeUserIsAdmin && (
            <div className={clsx(noCredentials && 'flex justify-center p-4')}>
              <CreateProviderCredentialsDialog defaultOpen={openCreateCredentialDialog !== null} />
            </div>
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
