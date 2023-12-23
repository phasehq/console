import { ApiEnvironmentSyncStatusChoices, EnvironmentSyncType, ServiceType } from '@/apollo/graphql'
import { relativeTimeFromDates } from '@/utils/time'
import clsx from 'clsx'
import { FaAngleDoubleRight, FaCube } from 'react-icons/fa'
import { SiCloudflare, SiCloudflarepages } from 'react-icons/si'
import { SyncStatusIndicator } from './SyncStatusIndicator'

export const SyncCard = (props: { sync: EnvironmentSyncType; showAppName?: boolean }) => {
  const { sync, showAppName } = props

  const serviceIcon = (service: ServiceType) => {
    if (service.id!.toLowerCase() === 'cloudflare_pages')
      return <SiCloudflarepages className="shrink-0" />
    else return <FaCube />
  }

  return (
    <div className="flex flex-wrap gap-4 justify-between p-2 rounded-lg border border-neutral-500/40 bg-zinc-100 dark:bg-zinc-800 text-sm font-medium">
      <div className="flex gap-2 items-center">
        {serviceIcon(sync.serviceInfo!)}
        <div>{sync.serviceInfo?.name}</div>
      </div>

      <div className="flex gap-4 items-center">
        <div className="tracking-wider text-sm">
          {showAppName && <span className="font-semibold">{sync.environment.app.name} </span>}
          {sync.environment.envType}
        </div>
        <FaAngleDoubleRight className="text-neutral-500 shrink-0" />
        <div className="flex gap-2">
          {JSON.parse(sync.options)['project_name']}
          <span className="text-neutral-500 font-normal">
            ({JSON.parse(sync.options)['environment']})
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div>{sync.status && <SyncStatusIndicator status={sync.status} showLabel />}</div>

        {sync.status === ApiEnvironmentSyncStatusChoices.InProgress ? (
          <div></div>
        ) : (
          <div>{sync.lastSync ? relativeTimeFromDates(new Date(sync.lastSync)) : 'never'}</div>
        )}
      </div>

      <div className="flex items-center gap-2 justify-end">
        <div
          className={clsx(
            'h-2 w-2 rounded-full',
            sync.isActive ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
          )}
        ></div>
        {sync.isActive ? 'Active' : 'Paused'}
      </div>
    </div>
  )
}
