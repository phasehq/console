import { FaProjectDiagram, FaRobot, FaUsers } from 'react-icons/fa'
import { Card } from '../common/Card'

import { AppType } from '@/apollo/graphql'
import { ProviderIcon } from '../syncing/ProviderIcon'
import { Avatar } from '../common/Avatar'
import { BsListColumnsReverse } from 'react-icons/bs'
import { EncryptionModeIndicator } from './EncryptionModeIndicator'
import clsx from 'clsx'
import { ReactNode, useContext } from 'react'
import CopyButton from '../common/CopyButton'
import { organisationContext } from '@/contexts/organisationContext'
import Link from 'next/link'

interface AppCardProps {
  app: AppType
  variant: 'normal' | 'compact'
}

interface AppCardMetaProps {
  icon: React.ReactElement
  count: number
  itemType: string
  children: ReactNode
  link?: string
}

const AppCardContent = ({ app, variant }: AppCardProps) => {
  const { name, id, members, serviceAccounts, environments } = app

  const { activeOrganisation: organisation } = useContext(organisationContext)

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

  const AppMetaCategory: React.FC<AppCardMetaProps> = ({
    icon,
    count,
    itemType,
    children,
    link,
  }) => {
    const content = () => (
      <div className="space-y-1 hidden lg:block">
        <div className={clsx(variant === 'normal' ? 'space-y-1' : 'flex items-center gap-4')}>
          {variant === 'normal' && count > 0 && (
            <div className="flex items-center gap-2 text-xl">
              {icon}
              <span className="font-light">{count}</span>
            </div>
          )}
          {variant === 'normal' && count > 0 && (
            <span className="text-neutral-500 font-medium text-[0.6rem] uppercase tracking-widest">
              {count === 1 ? itemType : `${itemType}s`}
            </span>
          )}
        </div>
        <div className="lg:flex items-center gap-1 text-base hidden">{children}</div>
      </div>
    )

    return link ? (
      <Link className="hidden lg:block" href={link}>
        {content()}
      </Link>
    ) : (
      content()
    )
  }

  const AppMetaRow = () => {
    return (
      <>
        <AppMetaCategory
          itemType="Member"
          count={members.length}
          icon={<FaUsers />}
          link={
            variant === 'normal'
              ? undefined
              : `/${organisation?.name}/apps/${app.id}/access/members`
          }
        >
          {members.slice(0, 5).map((member, index) => (
            <div
              key={member!.id}
              className={clsx(
                'rounded-full',
                index !== 0 && '-ml-3',
                index === 1 && 'z-[1]',
                index === 2 && 'z-[2]',
                index === 3 && 'z-[3]',
                index === 4 && 'z-[4]'
              )}
            >
              <Avatar member={member!} size="md" />
            </div>
          ))}
          {surplusMemberCount > 0 && (
            <span className="text-neutral-500 text-xs">+{surplusMemberCount}</span>
          )}
        </AppMetaCategory>

        <AppMetaCategory
          itemType="Service Account"
          count={serviceAccounts.length}
          icon={<FaRobot />}
          link={
            variant === 'normal'
              ? undefined
              : `/${organisation?.name}/apps/${app.id}/access/service-accounts`
          }
        >
          {serviceAccounts.slice(0, 5).map((account, index) => (
            <div
              key={account!.id}
              className={clsx(
                'rounded-full flex items-center shrink-0 bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-zinc-500/20 justify-center size-8 p-1 text-2xs font-semibold text-zinc-900 dark:text-zinc-100',

                index !== 0 && '-ml-3',
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
        </AppMetaCategory>

        <AppMetaCategory
          itemType="Environment"
          count={environments.length}
          icon={<BsListColumnsReverse />}
          link={variant === 'normal' ? undefined : `/${organisation?.name}/apps/${app.id}/`}
        >
          {environments.slice(0, 5).map((env, index) => (
            <div
              key={env!.id}
              className={clsx(
                'bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-zinc-500/20 rounded-full size-8 flex items-center justify-center shrink-0 text-zinc-800 dark:text-zinc-200 text-2xs font-semibold',
                index !== 0 && '-ml-3',
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
        </AppMetaCategory>

        {totalSyncCount > 0 && (
          <AppMetaCategory
            itemType="Integration"
            count={totalSyncCount}
            icon={<FaProjectDiagram />}
            link={
              variant === 'normal' ? undefined : `/${organisation?.name}/apps/${app.id}/syncing`
            }
          >
            {providers.slice(0, 5).map((providerId) => (
              <div key={providerId} className="text-2xl">
                <ProviderIcon providerId={providerId} />
              </div>
            ))}
            {surplusSynCount > 0 && (
              <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-xs">
                +{surplusSynCount}
              </span>
            )}
          </AppMetaCategory>
        )}
      </>
    )
  }

  return (
    <div
      className={clsx(
        'flex w-full',
        variant === 'normal'
          ? 'flex-col gap-8 justify-between rounded-xl'
          : 'gap-6 lg:gap-10 grid grid-cols-2 lg:grid-cols-6 justify-stretch items-center py-1'
      )}
    >
      <div
        className={clsx(
          'flex justify-between',
          variant === 'normal' ? 'items-start' : 'items-center col-span-2 w-full max-w-[28rem]'
        )}
      >
        <div className="space-y-0.5">
          <div
            className={clsx(
              'font-semibold flex items-center justify-between gap-2 text-zinc-700 dark:text-zinc-100 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition ease',
              variant === 'normal' ? 'text-2xl' : 'text-lg pl-3'
            )}
          >
            {variant === 'normal' ? (
              name
            ) : (
              <Link
                href={`/${organisation?.name}/apps/${app.id}`}
                className="hover:text-emerald-500 transition ease flex items-center gap-4 justify-between w-full"
              >
                {name}
                <div className="xl:hidden">
                  <EncryptionModeIndicator app={app} />
                </div>
              </Link>
            )}{' '}
          </div>
          {variant === 'normal' ? (
            <div className="text-2xs font-mono text-neutral-500 w-full break-all text-left">
              {id}
            </div>
          ) : (
            <CopyButton value={id} buttonVariant="ghost">
              <span className="text-2xs font-mono md:whitespace-nowrap">{id}</span>
            </CopyButton>
          )}
        </div>
        <div className="hidden xl:block">
          <EncryptionModeIndicator app={app} />
        </div>
      </div>

      {variant === 'normal' ? (
        <div className="flex items-center justify-between p-2 gap-6">
          <AppMetaRow />
        </div>
      ) : (
        <AppMetaRow />
      )}
    </div>
  )
}

export const AppCard = ({ app, variant }: AppCardProps) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  if (variant === 'normal')
    return (
      <Link href={`/${organisation?.name}/apps/${app.id}`}>
        <Card>
          <AppCardContent app={app} variant={variant} />
        </Card>
      </Link>
    )
  else
    return (
      <div className="hover:bg-neutral-500/10 transition ease">
        <AppCardContent app={app} variant={variant} />
      </div>
    )
}
