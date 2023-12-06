import { ApiEnvironmentSyncStatusChoices, EnvironmentSyncType } from '@/apollo/graphql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import TriggerEnvSync from '@/graphql/mutations/syncing/triggerSync.gql'
import { relativeTimeFromDates } from '@/utils/time'
import { useMutation } from '@apollo/client'
import clsx from 'clsx'
import { FaAngleDoubleRight, FaSync } from 'react-icons/fa'
import { Button } from '../common/Button'
import { UpdateCloudflareCredentials } from './Cloudflare/UpdateCloudflareCredentials'
import { DeleteSyncDialog } from './DeleteSyncDialog'
import { SyncStatusIndicator } from './SyncStatusIndicator'

export const SyncManagement = (props: { sync: EnvironmentSyncType; appId: string }) => {
  const { sync, appId } = props

  const [triggerSync] = useMutation(TriggerEnvSync)

  const credentialsDialog = () => {
    const serviceName = sync.serviceInfo?.name

    if (serviceName?.toLowerCase().includes('cloudflare'))
      return <UpdateCloudflareCredentials sync={sync} />
  }

  const handleSync = async () => {
    await triggerSync({
      variables: { syncId: sync.id },
      refetchQueries: [
        {
          query: GetAppSyncStatus,
          variables: { appId },
        },
      ],
    })
  }

  const isSyncing = sync.status === ApiEnvironmentSyncStatusChoices.InProgress

  return (
    <div className="py-4 space-y-4">
      <div className="grid grid-cols-2 w-full gap-4">
        <div className="text-neutral-500 uppercase tracking-widest text-sm">Environment</div>
        <div className="font-semibold">{sync.environment.name}</div>

        <div className="text-neutral-500 uppercase tracking-widest text-sm">Service</div>
        <div className="font-semibold">{sync.serviceInfo?.name}</div>

        <div className="text-neutral-500 uppercase tracking-widest text-sm">Project</div>
        <div className="font-semibold">
          {JSON.parse(sync.options)['project_name']}({JSON.parse(sync.options)['environment']})
        </div>

        <div className="text-neutral-500 uppercase tracking-widest text-sm">Status</div>
        <div className="flex items-center gap-2">
          <div
            className={clsx(
              'h-2 w-2 rounded-full',
              sync.isActive ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
            )}
          ></div>
          {sync.isActive ? 'Active' : 'Paused'}
        </div>

        <div className="text-neutral-500 uppercase tracking-widest text-sm">Created</div>
        <div className="font-semibold">{relativeTimeFromDates(new Date(sync.createdAt))}</div>

        <div className="text-neutral-500 uppercase tracking-widest text-sm">Last sync</div>
        <div className="font-semibold flex items-center gap-2">
          <SyncStatusIndicator status={sync.status} showLabel />
          {sync.status !== ApiEnvironmentSyncStatusChoices.InProgress &&
            relativeTimeFromDates(new Date(sync.lastSync))}
        </div>

        <div className="col-span-2">{credentialsDialog()}</div>

        <div className="col-span-2 flex items-center gap-4 justify-end pt-4 border-t border-neutral-500/40">
          <Button variant="primary" onClick={handleSync} disabled={isSyncing}>
            <FaSync className={isSyncing ? 'animate-spin' : ''} /> Sync now
          </Button>
          <DeleteSyncDialog sync={sync} appId={appId} />
        </div>
      </div>
    </div>
  )
}
