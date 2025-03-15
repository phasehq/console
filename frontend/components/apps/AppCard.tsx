import { FaProjectDiagram, FaRobot, FaUsers } from 'react-icons/fa'
import { Card } from '../common/Card'

import { AppType } from '@/apollo/graphql'
import { ProviderIcon } from '../syncing/ProviderIcon'
import { Avatar } from '../common/Avatar'
import { BsListColumnsReverse } from 'react-icons/bs'
import { EncryptionModeIndicator } from './EncryptionModeIndicator'
import clsx from 'clsx'
import { ReactNode } from 'react'

interface AppCardProps {
  app: AppType
  variant: 'normal' | 'compact'
}

interface AppCardMetaProps {
  icon: React.ReactElement
  count: number
  itemType: string
  children: ReactNode
}

export const AppCard = ({ app, variant }: AppCardProps) => {
  const { name, id, members, serviceAccounts, environments } = app

  const totalSyncCount = environments
    ? environments.reduce((acc, env) => acc + (env!.syncs?.length || 0), 0)
    : 0

  const providers: string[] = environments
    ? environments
        .flatMap((env) => {
          return env!.syncs.map((sync) => {
            const serviceInfo = sync!.serviceInfo
            const providerId = serviceInfo!.provider!.id
            return providerId
          })
        })
        .filter((id, index, array) => array.indexOf(id) === index)
    : []

  const surplusMemberCount = members.length > 5 ? members.length - 5 : 0

  const surplusServiceAccountsCount = serviceAccounts.length > 5 ? serviceAccounts.length - 5 : 0

  const surplusEnvCount = environments.length > 5 ? environments.length - 5 : 0

  const surplusSynCount = providers.length > 5 ? providers.length - 5 : 0

  const AppCardMeta: React.FC<AppCardMetaProps> = ({ icon, count, itemType, children }) => {
    return (
      <div className="space-y-1">
        <div className={clsx(variant === 'normal' ? 'space-y-1' : 'flex items-center gap-4')}>
          <div
            className={clsx(
              'flex items-center gap-2',
              variant === 'normal' ? 'text-xl' : 'text-sm'
            )}
          >
            {icon}
            <span className="font-light">{count}</span>
          </div>
          <span className="text-neutral-500 font-medium text-[0.6rem] uppercase tracking-widest">
            {count === 1 ? itemType : `${itemType}s`}
          </span>
        </div>
        <div className="lg:flex items-center gap-1 text-base hidden">{children}</div>
      </div>
    )
  }

  return (
    <Card>
      <div
        className={clsx(
          'rounded-xl  flex w-full  justify-between',
          variant === 'normal' ? 'flex-col gap-8' : 'gap-6 lg:gap-10 flex-col lg:flex-row'
        )}
      >
        <div className="space-y-1">
          <div
            className={clsx(
              'font-semibold flex items-center gap-2 text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition ease',
              variant === 'normal' ? 'text-2xl' : 'text-lg'
            )}
          >
            {name} <EncryptionModeIndicator app={app} />
          </div>
          <div className="text-2xs font-mono text-neutral-500 w-full break-all text-left">{id}</div>
        </div>

        <div
          className={clsx(
            variant === 'normal'
              ? 'flex items-center justify-between p-2 gap-6'
              : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-10 w-full lg:w-2/3'
          )}
        >
          <AppCardMeta itemType="Member" count={members.length} icon={<FaUsers />}>
            {members.slice(0, 5).map((member, index) => (
              <div
                key={member!.id}
                className={clsx(
                  index !== 0 && '-ml-3 shadow-lg',
                  index === 1 && 'z-[1]',
                  index === 2 && 'z-[2]',
                  index === 3 && 'z-[3]',
                  index === 4 && 'z-[4]'
                )}
              >
                <Avatar imagePath={member!.avatarUrl} size="sm" />
              </div>
            ))}
            {surplusMemberCount > 0 && (
              <span className="text-neutral-500 text-xs">+{surplusMemberCount}</span>
            )}
          </AppCardMeta>

          {serviceAccounts.length > 0 && (
            <AppCardMeta
              itemType="Service Account"
              count={serviceAccounts.length}
              icon={<FaRobot />}
            >
              {serviceAccounts.slice(0, 5).map((account, index) => (
                <div
                  key={account!.id}
                  className={clsx(
                    'rounded-full flex items-center shrink-0 bg-indigo-200 dark:bg-indigo-900 ring-1 ring-inset ring-indigo-500/20 shadow-xl justify-center size-6 p-1 text-2xs font-semibold text-zinc-900 dark:text-zinc-100',

                    index !== 0 && '-ml-3 shadow-lg',
                    index === 1 && 'z-[1]',
                    index === 2 && 'z-[2]',
                    index === 3 && 'z-[3]',
                    index === 4 && 'z-[4]'
                  )}
                >
                  {account?.name.slice(0, 1)}
                </div>
              ))}
              {surplusServiceAccountsCount > 0 && (
                <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-xs">
                  +{surplusServiceAccountsCount}
                </span>
              )}
            </AppCardMeta>
          )}

          <AppCardMeta
            itemType="Environment"
            count={environments.length}
            icon={<BsListColumnsReverse />}
          >
            {environments.slice(0, 5).map((env, index) => (
              <div
                key={env!.id}
                className={clsx(
                  'bg-sky-200 dark:bg-sky-900 ring-1 ring-inset ring-sky-500/20 rounded-full size-6 flex items-center justify-center shrink-0 text-zinc-800 dark:text-zinc-200 text-2xs font-semibold',
                  index !== 0 && '-ml-3 shadow-lg',
                  index === 1 && 'z-[1]',
                  index === 2 && 'z-[2]',
                  index === 3 && 'z-[3]',
                  index === 4 && 'z-[4]'
                )}
              >
                {env!.name.slice(0, 1)}
              </div>
            ))}
            {surplusEnvCount > 0 && (
              <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-xs">
                +{surplusEnvCount}
              </span>
            )}
          </AppCardMeta>

          {totalSyncCount > 0 && (
            <AppCardMeta itemType="Integration" count={totalSyncCount} icon={<FaProjectDiagram />}>
              {providers.slice(0, 5).map((providerId) => (
                <ProviderIcon key={providerId} providerId={providerId} />
              ))}
              {surplusSynCount > 0 && (
                <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-xs">
                  +{surplusSynCount}
                </span>
              )}
            </AppCardMeta>
          )}
        </div>
      </div>
    </Card>
  )
}
