import { FaProjectDiagram, FaRobot, FaUsers } from 'react-icons/fa'
import { Card } from '../common/Card'

import { AppType } from '@/apollo/graphql'
import { ProviderIcon } from '../syncing/ProviderIcon'
import { Avatar } from '../common/Avatar'
import { BsListColumnsReverse } from 'react-icons/bs'
import { EncryptionModeIndicator } from './EncryptionModeIndicator'

interface AppCardProps {
  app: AppType
}

export const AppCard = (props: AppCardProps) => {
  const { name, id, members, serviceAccounts, environments } = props.app

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

  return (
    <Card>
      <div className="rounded-xl p-4 flex flex-col w-full gap-10 justify-between">
        <div className="space-y-1">
          <div className="text-2xl font-semibold flex items-center gap-2 text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition ease">
            {name} <EncryptionModeIndicator app={props.app} />
          </div>
          <div className="text-2xs font-mono text-neutral-500 w-full break-all text-left">{id}</div>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-2xl">
              <FaUsers />
              <span className="font-light">{members.length}</span>
            </div>
            <span className="text-neutral-500 font-medium text-2xs uppercase tracking-widest">
              {members.length > 1 ? 'Members' : 'Member'}
            </span>
            <div className="flex items-center gap-1 text-base">
              {members.slice(0, 5).map((member) => (
                <Avatar key={member!.id} member={member || undefined} size="sm" />
              ))}
              {surplusMemberCount > 0 && (
                <span className="text-neutral-500 text-xs">+{surplusMemberCount}</span>
              )}
            </div>
          </div>

          {serviceAccounts.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-2xl">
                <FaRobot />
                <span className="font-light">{serviceAccounts.length}</span>
              </div>
              <span className="text-neutral-500 font-medium text-2xs uppercase tracking-widest">
                {serviceAccounts.length > 1 ? 'Service Accounts' : 'Service Account'}
              </span>
              <div className="flex items-center gap-1 text-base">
                {serviceAccounts.slice(0, 5).map((account) => (
                  <div
                    key={account!.id}
                    className="rounded-full flex items-center bg-neutral-500/40 justify-center size-5 p-1"
                  >
                    <span className="text-2xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {account?.name.slice(0, 1)}
                    </span>
                  </div>
                ))}
                {surplusMemberCount > 0 && (
                  <span className="text-neutral-500 text-xs">+{surplusMemberCount}</span>
                )}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-2xl">
              <BsListColumnsReverse />
              <span className="font-light">{environments.length}</span>
            </div>
            <span className="text-neutral-500 font-medium text-2xs uppercase tracking-widest">
              {environments.length > 1 ? 'Environments' : 'Environment'}
            </span>
            <div className="flex items-center gap-1 text-base">
              {environments.slice(0, 5).map((env) => (
                <div
                  key={env!.id}
                  className="bg-neutral-400/10 ring-1 inset-inset ring-neutral-400/20 rounded-full px-2 text-zinc-800 dark:text-zinc-200 text-2xs font-semibold"
                >
                  {env!.name.slice(0, 1)}
                </div>
              ))}
              {surplusEnvCount > 0 && (
                <span className="text-neutral-500 text-xs">+{surplusEnvCount}</span>
              )}
            </div>
          </div>

          {totalSyncCount > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-2xl">
                <FaProjectDiagram />
                <span className="font-light">{totalSyncCount}</span>
              </div>
              <span className="text-neutral-500 font-medium text-2xs uppercase tracking-widest">
                {totalSyncCount > 1 ? 'Integrations' : 'Integration'}
              </span>
              <div className="flex items-center gap-2 text-base">
                {providers.slice(0, 5).map((providerId) => (
                  <ProviderIcon key={providerId} providerId={providerId} />
                ))}
                {surplusSynCount > 0 && (
                  <span className="text-neutral-500 text-xs">+{surplusSynCount}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
