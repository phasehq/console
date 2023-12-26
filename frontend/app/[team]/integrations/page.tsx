'use client'

import { organisationContext } from '@/contexts/organisationContext'
import { useContext, useEffect } from 'react'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import GetOrganisationSyncs from '@/graphql/queries/syncing/GetOrgSyncs.gql'
import { useLazyQuery, useQuery } from '@apollo/client'
import { EnvironmentSyncType, ProviderCredentialsType } from '@/apollo/graphql'
import { CreateProviderCredentialsDialog } from '@/components/syncing/CreateProviderCredentialsDialog'
import { SyncCard } from '@/components/syncing/SyncCard'
import { ManageSyncDialog } from '@/components/syncing/ManageSyncDialog'
import { ProviderCredentialCard } from '@/components/syncing/ProviderCredentialCard'
import { FaProjectDiagram } from 'react-icons/fa'

export default function Integrations({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [getSavedCredentials, { data: credentialsData }] = useLazyQuery(GetSavedCredentials)
  const [getOrgSyncs, { data: syncsData }] = useLazyQuery(GetOrganisationSyncs)

  useEffect(() => {
    if (organisation) {
      getSavedCredentials({ variables: { orgId: organisation.id }, pollInterval: 10000 })
      getOrgSyncs({ variables: { orgId: organisation.id }, pollInterval: 10000 })
    }
  }, [organisation])

  return (
    <div className="w-full space-y-8 p-8 text-black dark:text-white">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold">{params.team} Integrations</h1>
        <p className="text-neutral-500">Manage integrations with third party services</p>
      </div>

      <div className="space-y-4">
        <div className="border-b border-neutral-500/20 pb-4">
          <h2 className="text-black dark:text-white text-xl font-medium">Syncs</h2>
          <p className="text-neutral-500">Manage syncs</p>
        </div>

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
          </div>
        )}
      </div>

      <hr className="border-neutral-500/40" />

      <div className="space-y-4">
        <div className="border-b border-neutral-500/20 pb-4">
          <h2 className="text-black dark:text-white text-xl font-medium"> Authentication</h2>
          <p className="text-neutral-500">Manage stored credentials for third party services</p>
        </div>

        {credentialsData?.savedCredentials.length === 0 && (
          <div className="flex flex-col items-center text-center p-16">
            <div className="font-semibold text-black dark:text-white text-xl">
              No authentication credentials
            </div>
            <div className="text-neutral-500">
              Set up a new authentication method to start syncing with third party services.
            </div>
            <div className="flex justify-center p-4">
              <CreateProviderCredentialsDialog />
            </div>
          </div>
        )}

        {credentialsData?.savedCredentials.length > 0 && (
          <div className="flex justify-end">
            <CreateProviderCredentialsDialog />
          </div>
        )}

        {credentialsData?.savedCredentials.length > 0 &&
          credentialsData?.savedCredentials.map((credential: ProviderCredentialsType) => (
            <ProviderCredentialCard key={credential.id} credential={credential} />
          ))}
      </div>
    </div>
  )
}
