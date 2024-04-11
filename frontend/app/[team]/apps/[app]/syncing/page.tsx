'use client'

import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import { useQuery } from '@apollo/client'
import { EnvironmentSyncType } from '@/apollo/graphql'
import { useContext } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import { SyncCard } from '@/components/syncing/SyncCard'
import { SyncOptions } from '@/components/syncing/SyncOptions'
import { useSearchParams } from 'next/navigation'
import { userIsAdmin } from '@/utils/permissions'
import { EnableSSEDialog } from '@/components/apps/EnableSSEDialog'

export default function Syncing({ params }: { params: { team: string; app: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const searchParams = useSearchParams()

  const openCreateSyncPanel = searchParams?.get('newSync')

  const { data } = useQuery(GetAppSyncStatus, {
    variables: { appId: params.app },
    pollInterval: 10000,
  })

  const activeUserIsAdmin = organisation ? userIsAdmin(organisation.role!) : false

  return (
    <div className="w-full space-y-8 pt-8 text-black dark:text-white">
      {data?.syncEnabled === false && (
        <div className="flex flex-col gap-4 h-96 items-center justify-center">
          <div className="space-y-1 text-center">
            <div className="text-black dark:text-white text-3xl font-semibold">Enable syncing</div>
            <div className="text-neutral-500 text-lg">
              Syncing is not yet enabled for this app. Click the button below to enable syncing.
            </div>
          </div>
          <EnableSSEDialog appId={params.app} />
        </div>
      )}
      {data?.syncEnabled === true && (
        <>
          {data.syncs && data.syncs.length > 0 && (
            <div className="flex flex-col gap-4 border-b border-neutral-500/40 pb-8">
              <div className="text-2xl font-semibold pb-4">Active Syncs</div>
              {data.syncs.map((sync: EnvironmentSyncType) => (
                <SyncCard key={sync.id} sync={sync} showAppName={false} showManageButton={true} />
              ))}
            </div>
          )}

          {activeUserIsAdmin && (
            <SyncOptions
              appId={params.app}
              defaultOpen={openCreateSyncPanel || (data.syncs && data.syncs.length === 0)}
            />
          )}
        </>
      )}
    </div>
  )
}
