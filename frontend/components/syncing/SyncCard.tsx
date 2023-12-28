import { ApiEnvironmentSyncStatusChoices, EnvironmentSyncType, ServiceType } from '@/apollo/graphql'
import { relativeTimeFromDates } from '@/utils/time'
import clsx from 'clsx'
import {
  FaAngleDoubleRight,
  FaCog,
  FaCube,
  FaExclamation,
  FaExclamationTriangle,
  FaKey,
  FaSync,
} from 'react-icons/fa'
import { SiCloudflare, SiCloudflarepages } from 'react-icons/si'
import { SyncStatusIndicator } from './SyncStatusIndicator'
import { Button } from '../common/Button'
import { ManageSyncDialog } from './ManageSyncDialog'
import { Tag } from '../environments/SecretRow'

export const SyncCard = (props: {
  sync: EnvironmentSyncType
  showAppName?: boolean
  showManageButton?: boolean
}) => {
  const { sync, showAppName, showManageButton } = props

  const serviceIcon = (service: ServiceType) => {
    if (service.id!.toLowerCase() === 'cloudflare_pages')
      return <SiCloudflare className="shrink-0" />
    else return <FaCube />
  }

  return (
    <div
      className={clsx(
        'grid gap-4 items-center justify-between py-2 px-4 rounded-lg border border-neutral-500/40 bg-zinc-100 dark:bg-zinc-800 text-sm font-medium',
        showManageButton ? 'grid-cols-6' : 'grid-cols-4'
      )}
    >
      <div className="flex items-center gap-2">
        <div
          className={clsx(
            'h-2 w-2 rounded-full',
            sync.isActive ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
          )}
        ></div>
        {sync.isActive ? 'Active' : 'Paused'}
      </div>

      <div
        className={clsx(
          'flex gap-4 items-center justify-evenly',
          showManageButton ? 'col-span-3' : 'col-span-2'
        )}
      >
        <div className="flex flex-col">
          {showAppName && (
            <span className="text-black dark:text-white font-semibold">
              {sync.environment.app.name}{' '}
            </span>
          )}
          <span
            className={clsx(
              showAppName
                ? 'tracking-wider text-sm text-neutral-500'
                : 'text-black dark:text-white font-semibold'
            )}
          >
            {sync.environment.envType}
          </span>
        </div>

        <div>
          <FaAngleDoubleRight className="text-neutral-500 text-xl justify-self-end" />
        </div>

        <div>
          <div className="flex gap-2 items-center">
            {serviceIcon(sync.serviceInfo!)}
            <div>{sync.serviceInfo?.name}</div>
          </div>
          <div className="flex gap-2">
            {JSON.parse(sync.options)['project_name']}
            <span className="text-neutral-500 font-normal">
              ({JSON.parse(sync.options)['environment']})
            </span>
          </div>
        </div>
      </div>

      {/* <div className="flex items-center gap-2">
        <FaKey />
        {sync.authentication?.name}
      </div> */}

      <div>
        {/* <div className="flex items-center gap-2">
          <div
            className={clsx(
              'h-2 w-2 rounded-full',
              sync.isActive ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
            )}
          ></div>
          {sync.isActive ? 'Active' : 'Paused'}
        </div> */}
        <div className="flex items-center justify-center gap-2">
          <div>{sync.status && <SyncStatusIndicator status={sync.status} showLabel />}</div>

          {sync.status === ApiEnvironmentSyncStatusChoices.InProgress ? (
            <div></div>
          ) : (
            <div className="text-neutral-500">
              {sync.lastSync ? relativeTimeFromDates(new Date(sync.lastSync)) : 'never'}
            </div>
          )}
        </div>
      </div>

      {showManageButton && (
        <div className="flex justify-end items-center gap-4">
          {sync.authentication === null && (
            <FaExclamationTriangle className="text-amber-500" title="Action required" />
          )}
          <ManageSyncDialog
            sync={sync}
            button={
              <Button type="button" variant="secondary" title="Manage sync">
                <FaCog /> Manage
              </Button>
            }
          />
        </div>
      )}
    </div>
  )
}
