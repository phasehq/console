'use client'

import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import { useQuery } from '@apollo/client'
import { EnvironmentSyncType } from '@/apollo/graphql'
import { useContext } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import { SyncCard } from '@/components/syncing/SyncCard'
import { SyncOptions } from '@/components/syncing/SyncOptions'
import { useSearchParams } from 'next/navigation'
import { useAppPermissions } from '@/hooks/useAppPermissions'
import { EnableSSEDialog } from '@/components/apps/EnableSSEDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { FaBan } from 'react-icons/fa'

export default function Syncing({ params }: { params: { team: string; app: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const searchParams = useSearchParams()

  const openCreateSyncPanel = searchParams?.get('newSync')

  const { hasPermission } = useAppPermissions(params.app)

  const userCanReadIntegrations = hasPermission('Integrations', 'read', true)
  const userCanCreateSyncs = hasPermission('Integrations', 'create', true)

  const { data } = useQuery(GetAppSyncStatus, {
    variables: { appId: params.app },
    pollInterval: 10000,
    skip: !userCanReadIntegrations,
  })

  if (!userCanReadIntegrations)
    return (
      <EmptyState
        title="Access restricted"
        subtitle="You don't have the permissions required to view Integrations."
        graphic={
          <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
            <FaBan />
          </div>
        }
      >
        <></>
      </EmptyState>
    )

  return (
    <div className="w-full space-y-3 sm:space-y-4 lg:space-y-6 pt-3 sm:pt-4 lg:pt-6 text-black dark:text-white px-3 sm:px-4 lg:px-6">
      {data?.sseEnabled === false && (
        <>
          <div className="flex flex-col gap-4 h-64 max-w-screen-md mx-auto items-center justify-center">
            <div className="space-y-1 text-center">
              <div className="text-black dark:text-white text-sm font-medium">Enable Secret Syncing</div>
              <p className="text-neutral-500">
                Server-side encryption (SSE) is not yet enabled for this app. SSE is required to allow
                automatic syncing of secrets.
              </p>
            </div>
            <EnableSSEDialog appId={params.app} />
          </div>
          {userCanCreateSyncs && (
            <div className="cursor-not-allowed" title="Enable SSE above to start creating syncs">
              <div className="opacity-50 pointer-events-none">
                <SyncOptions
                  appId={params.app}
                  defaultOpen={openCreateSyncPanel || (data.syncs && data.syncs.length === 0)}
                />
              </div>
            </div>
          )}
        </>
      )}
      {data?.sseEnabled === true && (
        <>
          {userCanCreateSyncs && (
            <SyncOptions
              appId={params.app}
              defaultOpen={openCreateSyncPanel || (data.syncs && data.syncs.length === 0)}
            />
          )}
          {data.syncs && data.syncs.length > 0 && (
            <div className="flex flex-col gap-2 border-b border-neutral-500/40 pb-8">
              <div className="text-sm font-medium pb-4">Active Syncs</div>
              {data.syncs.map((sync: EnvironmentSyncType) => (
                <SyncCard key={sync.id} sync={sync} showAppName={false} showManageButton={true} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
