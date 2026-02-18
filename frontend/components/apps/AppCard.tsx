import { FaProjectDiagram, FaRobot, FaUsers } from 'react-icons/fa'
import { Card } from '../common/Card'
import { AppType } from '@/apollo/graphql'
import { ProviderIcon } from '../syncing/ProviderIcon'
import { Avatar } from '../common/Avatar'
import { BsListColumnsReverse } from 'react-icons/bs'
import { EncryptionModeIndicator, EncryptionDot } from './EncryptionModeIndicator'
import clsx from 'clsx'
import { ReactNode, useContext } from 'react'
import CopyButton from '../common/CopyButton'
import { organisationContext } from '@/contexts/organisationContext'
import Link from 'next/link'
import { relativeTimeFromDates } from '@/utils/time'
import { useRouter } from 'next/navigation'
import { AppTabs } from '@/utils/app'

interface AppCardProps {
  app: AppType
  variant: 'normal' | 'compact'
  tabToLink?: AppTabs
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

    if (variant === 'normal') return count > 0 ? content() : <></>

    if (variant === 'compact') {
      if (count > 0) {
        return link ? (
          <Link
            title={`View ${app.name} ${itemType}s`}
            className="hidden lg:flex w-min group"
            href={link}
            onClick={(e) => e.stopPropagation()}
          >
            {content()}
          </Link>
        ) : (
          content()
        )
      } else return <div></div>
    }
  }

  const CondensedAppMetaCounts = () => {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 text-xs text-neutral-500">
          <FaUsers />
          {members.length}
        </div>

        <div className="flex items-center gap-1 text-xs text-neutral-500">
          <FaRobot />
          {serviceAccounts.length}
        </div>

        <div className="flex items-center gap-1 text-xs text-neutral-500">
          <BsListColumnsReverse />
          {environments.length}
        </div>

        <div className="flex items-center gap-1 text-xs text-neutral-500">
          <FaProjectDiagram />
          {totalSyncCount}
        </div>
      </div>
    )
  }

  const AppMetaRow = () => {
    return (
      <div
        className={clsx(
          variant === 'compact'
            ? 'col-span-5 hidden lg:grid grid-cols-5 justify-stretch gap-4'
            : 'flex items-center justify-between gap-2 w-full'
        )}
      >
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
                'rounded-full  transition ease',
                variant === 'compact' && 'group-hover:saturate-50',
                index !== 0 && '-ml-3',
                index === 1 && 'z-[1]',
                index === 2 && 'z-[2]',
                index === 3 && 'z-[3]',
                index === 4 && 'z-[4]'
              )}
            >
              <Avatar showTitle={false} member={member!} size="md" />
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
                'rounded-full transition ease',
                variant === 'compact' && 'group-hover:saturate-50',
                index !== 0 && '-ml-3',
                index === 1 && 'z-[1]',
                index === 2 && 'z-[2]',
                index === 3 && 'z-[3]',
                index === 4 && 'z-[4]'
              )}
            >
              <Avatar serviceAccount={account ?? undefined} size="md" />
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
                'bg-zinc-100 dark:bg-zinc-800  transition ease  ring-1 ring-inset ring-zinc-500/20 rounded-full size-8 flex items-center justify-center shrink-0 text-zinc-800 dark:text-zinc-200 text-2xs font-semibold',
                variant === 'compact' && 'group-hover:bg-zinc-50 group-hover:dark:bg-zinc-700',
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

        <AppMetaCategory
          itemType="Integration"
          count={totalSyncCount}
          icon={<FaProjectDiagram />}
          link={variant === 'normal' ? undefined : `/${organisation?.name}/apps/${app.id}/syncing`}
        >
          {providers.slice(0, 5).map((providerId) => (
            <div
              key={providerId}
              className={clsx(
                'text-2xl transition ease',
                variant === 'compact' && 'group-hover:saturate-50'
              )}
            >
              <ProviderIcon providerId={providerId} />
            </div>
          ))}
          {surplusSynCount > 0 && (
            <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-xs">
              +{surplusSynCount}
            </span>
          )}
        </AppMetaCategory>

        {variant === 'compact' && (
          <div className="text-xs text-neutral-500 hidden lg:block">
            {app.updatedAt && relativeTimeFromDates(new Date(app.updatedAt))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'flex w-full',
        variant === 'normal'
          ? 'flex-col gap-8 justify-between rounded-xl'
          : 'gap-6 lg:gap-10 grid grid-cols-2 lg:grid-cols-7 justify-stretch items-center py-1'
      )}
    >
      <div
        className={clsx(
          'flex',
          variant === 'normal'
            ? 'justify-between items-start'
            : 'col-span-2 w-full lg:max-w-[24rem] pl-3'
        )}
      >
        <div className="space-y-0.5 w-full">
          <div
            className={clsx(
              'font-semibold text-zinc-700 dark:text-zinc-100 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition ease flex items-center gap-2',
              variant === 'normal' ? 'text-2xl' : 'text-lg'
            )}
          >
            {variant === 'normal' ? (
              <>{name}</>
            ) : (
              <Link
                href={`/${organisation?.name}/apps/${app.id}`}
                className="flex items-center gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                <EncryptionDot sseEnabled={app.sseEnabled!} />
                {name}
              </Link>
            )}
          </div>
          {variant === 'normal' ? (
            <div className="text-2xs font-mono text-neutral-500 w-full break-all text-left">
              {id}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div onClick={(e) => e.stopPropagation()}>
                <CopyButton value={id} buttonVariant="ghost">
                  <span className="text-2xs font-mono md:whitespace-nowrap text-neutral-500">
                    {id}
                  </span>
                </CopyButton>
              </div>
              <div className="lg:hidden">
                <CondensedAppMetaCounts />
              </div>
            </div>
          )}
        </div>
        {variant === 'normal' && <EncryptionDot sseEnabled={app.sseEnabled!} />}
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

export const AppCard = ({ app, variant, tabToLink }: AppCardProps) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const router = useRouter()

  const link = `/${organisation?.name}/apps/${app.id}/${tabToLink || ''}`

  const handleRowClick = (e?: React.MouseEvent) => {
    e?.stopPropagation()

    // If ctrl/cmd key was pressed, open in new tab
    if (e && (e.ctrlKey || e.metaKey)) {
      window.open(link, '_blank')
    } else {
      router.push(link)
    }
  }

  if (variant === 'normal')
    return (
      <Link href={link}>
        <Card>
          <AppCardContent app={app} variant={variant} />
        </Card>
      </Link>
    )
  else
    return (
      <div
        className="hover:bg-neutral-500/10 transition ease cursor-pointer"
        onClick={handleRowClick}
      >
        <AppCardContent app={app} variant={variant} />
      </div>
    )
}
