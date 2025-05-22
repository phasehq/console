'use client'

import { organisationContext } from '@/contexts/organisationContext'
import { useContext, useState, useEffect, useMemo } from 'react'
import GetOrganisationSyncs from '@/graphql/queries/syncing/GetOrgSyncs.gql'
import GetProviderList from '@/graphql/queries/syncing/getProviders.gql'
import { useQuery } from '@apollo/client'
import { ProviderCredentialsType, ProviderType } from '@/apollo/graphql'
import { CreateProviderCredentialsDialog } from '@/components/syncing/CreateProviderCredentialsDialog'
import { ProviderCredentialCard } from '@/components/syncing/ProviderCredentialCard'
import { FaBan } from 'react-icons/fa'
import clsx from 'clsx'
import { userHasPermission } from '@/utils/access/permissions'
import { useRouter, useSearchParams } from 'next/navigation'
import { ProviderCard } from '@/components/syncing/CreateProviderCredentials'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'

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

  const userCanReadApps = organisation
    ? userHasPermission(organisation.role?.permissions, 'Apps', 'read')
    : false

  const router = useRouter()
  const searchParams = useSearchParams()
  const providerFromUrl = searchParams?.get('provider')
  const { data: providersData } = useQuery(GetProviderList)
  const providers = useMemo(() => providersData?.providers ?? [], [providersData?.providers])
  const [provider, setProvider] = useState<ProviderType | null>(null)

  // Simplified useEffect that only handles provider param
  useEffect(() => {
    if (providerFromUrl && providers.length > 0) {
      const matchingProvider = providers.find(
        (p: ProviderType) => p.id.toLowerCase() === providerFromUrl.toLowerCase()
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

  const noCredentials = data?.savedCredentials.length === 0

  const closeDialog = () => {
    setProvider(null)
    router.replace(`/${params.team}/integrations/credentials`)
  }

  if (loading)
    return (
      <div className="w-full flex items-center justify-center py-40">
        <Spinner size="md" />
      </div>
    )

  return (
    <div className="w-full space-y-8 md:space-y-10 text-black dark:text-white">
      {userCanReadIntegrationCredentials ? (
        <div className="space-y-4">
          <div className="border-b border-neutral-500/20 pb-4">
            <h2 className="text-black dark:text-white text-xl font-medium">
              Third-party integration credentials
            </h2>
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
                      {providers.map((provider: ProviderType) => (
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
    </div>
  )
}
