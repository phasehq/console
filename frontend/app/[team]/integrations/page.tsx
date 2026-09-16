'use client'

import { organisationContext } from '@/contexts/organisationContext'
import { useContext, useState, useEffect, useMemo, use } from 'react'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import GetProviderList from '@/graphql/queries/syncing/getProviders.gql'
import { useQuery } from '@apollo/client'
import { ProviderType } from '@/apollo/graphql'
import { CreateProviderCredentialsDialog } from '@/components/syncing/CreateProviderCredentialsDialog'
import {
  IntegrationCredentialsTable,
  IntegrationCredentialsTableSkeleton,
} from '@/components/syncing/IntegrationCredentialsTable'
import { FaBan, FaExclamationTriangle, FaPlug } from 'react-icons/fa'
import { userHasPermission } from '@/utils/access/permissions'
import { useRouter, useSearchParams } from 'next/navigation'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/common/Button'
import type { IntegrationCredentialSummary } from '@/utils/integrationCredentials'
import { integrationsPath } from '@/utils/integrations/routes'

export default function Integrations(props: { params: Promise<{ team: string }> }) {
  const params = use(props.params)
  const { activeOrganisation: organisation } = useContext(organisationContext)

  // permissions
  const userCanReadIntegrationCredentials = organisation
    ? userHasPermission(organisation.role?.permissions, 'IntegrationCredentials', 'read')
    : false

  const userCanCreateIntegrationsCredentials = organisation
    ? userHasPermission(organisation.role?.permissions, 'IntegrationCredentials', 'create')
    : false

  const userCanUpdateIntegrationCredentials = organisation
    ? userHasPermission(organisation.role?.permissions, 'IntegrationCredentials', 'update')
    : false

  const userCanDeleteIntegrationCredentials = organisation
    ? userHasPermission(organisation.role?.permissions, 'IntegrationCredentials', 'delete')
    : false

  const router = useRouter()
  const searchParams = useSearchParams()
  const providerFromUrl = searchParams?.get('provider')
  const credentialFromUrl = searchParams?.get('credential')
  const { data: providersData } = useQuery(GetProviderList, {
    skip: !userCanCreateIntegrationsCredentials,
  })
  const providers = useMemo(() => providersData?.providers ?? [], [providersData?.providers])
  const [provider, setProvider] = useState<ProviderType | null>(null)

  // Simplified useEffect that only handles provider param
  useEffect(() => {
    if (credentialFromUrl) {
      setProvider(null)
      return
    }

    if (providerFromUrl && !credentialFromUrl && providers.length > 0) {
      const matchingProvider = providers.find(
        (p: ProviderType) => p.id.toLowerCase() === providerFromUrl.toLowerCase()
      )
      if (matchingProvider) {
        setProvider(matchingProvider)
      }
    }
  }, [credentialFromUrl, providerFromUrl, providers])

  // This list query is metadata-only. Secret material is loaded for one
  // credential only when its Manage dialog is opened.
  const { data, loading, error, refetch } = useQuery(GetSavedCredentials, {
    variables: { orgId: organisation?.id },
    pollInterval: 10000,
    skip: !organisation || !userCanReadIntegrationCredentials,
    fetchPolicy: 'cache-and-network',
    nextFetchPolicy: 'cache-and-network',
  })

  const credentials = (data?.savedCredentials || []).filter(
    Boolean
  ) as IntegrationCredentialSummary[]
  const noCredentials = credentials.length === 0
  const closeDialog = () => {
    setProvider(null)
    router.replace(integrationsPath(params.team))
  }

  if (!organisation || (loading && !data)) {
    return (
      <div className="space-y-5">
        <div className="space-y-1 border-b border-neutral-500/20 pb-4">
          <div className="h-5 w-44 animate-pulse rounded bg-neutral-500/10 motion-reduce:animate-none" />
          <div className="h-4 w-72 max-w-full animate-pulse rounded bg-neutral-500/10 motion-reduce:animate-none" />
        </div>
        <IntegrationCredentialsTableSkeleton />
      </div>
    )
  }

  return (
    <div className="w-full text-black dark:text-white">
      {userCanReadIntegrationCredentials ? (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 border-b border-neutral-500/20 pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-medium text-black dark:text-white">
                Connected integrations
              </h2>
              <p className="mt-1 text-sm text-neutral-500">
                Third-party services connected to your organisation.
              </p>
            </div>
            {!noCredentials && userCanCreateIntegrationsCredentials && (
              <CreateProviderCredentialsDialog
                showButton
                initialProvider={provider}
                triggerLabel="Add integration"
                defaultOpen={!!provider && !credentialFromUrl}
                closeDialogCallback={closeDialog}
                onCreated={() => {
                  void refetch()
                }}
                key={provider?.id || 'new-integration'}
              />
            )}
          </div>

          {error ? (
            <EmptyState
              title="Could not load integrations"
              subtitle="The credential inventory could not be loaded. Try again."
              graphic={
                <div className="text-5xl text-red-500/70">
                  <FaExclamationTriangle />
                </div>
              }
            >
              <Button type="button" variant="secondary" onClick={() => void refetch()}>
                Retry
              </Button>
            </EmptyState>
          ) : noCredentials ? (
            <EmptyState
              title="No connected integrations"
              subtitle={
                userCanCreateIntegrationsCredentials
                  ? 'Connect the first third-party service you want Phase to use.'
                  : 'Contact an organisation admin or owner to add an integration.'
              }
              graphic={
                <div className="text-5xl text-neutral-300 dark:text-neutral-700">
                  <FaPlug />
                </div>
              }
            >
              {userCanCreateIntegrationsCredentials ? (
                <CreateProviderCredentialsDialog
                  showButton
                  initialProvider={provider}
                  triggerLabel="Add integration"
                  defaultOpen={!!provider && !credentialFromUrl}
                  closeDialogCallback={closeDialog}
                  onCreated={() => {
                    void refetch()
                  }}
                  key={provider?.id || 'first-integration'}
                />
              ) : (
                <></>
              )}
            </EmptyState>
          ) : (
            <IntegrationCredentialsTable
              credentials={credentials}
              organisationId={organisation.id}
              canEdit={userCanUpdateIntegrationCredentials}
              canDelete={userCanDeleteIntegrationCredentials}
              onChanged={() => refetch()}
              initialProviderId={providerFromUrl}
              highlightedCredentialId={credentialFromUrl}
            />
          )}
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
