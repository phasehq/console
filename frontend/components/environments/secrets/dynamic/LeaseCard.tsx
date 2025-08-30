import {
  ApiDynamicSecretLeaseStatusChoices,
  DynamicSecretLeaseType,
  DynamicSecretType,
} from '@/apollo/graphql'
import { Avatar } from '@/components/common/Avatar'
import { Button } from '@/components/common/Button'
import { relativeTimeFromDates } from '@/utils/time'
import clsx from 'clsx'
import { FaBan } from 'react-icons/fa6'
import { FiRefreshCw } from 'react-icons/fi'
import { RenewLeaseDialog } from './RenewLeaseDialog'
import { RevokeLeaseDialog } from './RevokeLeaseDialog'

export const LeaseCard = ({
  secret,
  lease,
}: {
  secret: DynamicSecretType
  lease: DynamicSecretLeaseType
}) => {
  const toTitleCase = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()

  //const isExpired = new Date(lease.expiresAt) <= new Date()
  const isRevoked = lease.revokedAt !== null && new Date(lease.revokedAt) <= new Date()

  const leaseStatusBadge = (status: ApiDynamicSecretLeaseStatusChoices) => {
    const styles: Record<ApiDynamicSecretLeaseStatusChoices, string> = {
      [ApiDynamicSecretLeaseStatusChoices.Active]:
        'bg-emerald-400/10 text-emerald-400 ring-1 ring-inset ring-emerald-400/10',
      [ApiDynamicSecretLeaseStatusChoices.Created]:
        'bg-blue-400/10 text-blue-400 ring-1 ring-inset ring-blue-400/10',
      [ApiDynamicSecretLeaseStatusChoices.Expired]:
        'bg-gray-400/10 text-gray-400 ring-1 ring-inset ring-gray-400/10',
      [ApiDynamicSecretLeaseStatusChoices.Renewed]:
        'bg-emerald-400/10 text-emerald-400 ring-1 ring-inset ring-emerald-400/10',
      [ApiDynamicSecretLeaseStatusChoices.Revoked]:
        'bg-red-400/10 text-red-400 ring-1 ring-inset ring-red-400/10',
    }

    return (
      <span
        className={clsx(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium',
          styles[status] ??
            'bg-neutral-400/10 text-neutral-700 ring-1 ring-inset ring-neutral-400/20'
        )}
      >
        <span className="size-2 rounded-full bg-current" />
        {toTitleCase(status)}
      </span>
    )
  }

  return (
    <div className="grid grid-cols-5 text-sm py-2" key={lease.id}>
      <div className="col-span-2">
        <div className="flex items-center gap-1">{leaseStatusBadge(lease.status)}</div>
        <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{lease.name}</div>
        <div className="font-mono text-2xs text-neutral-500">{lease.id}</div>
      </div>

      <div className="space-y-1 col-span-2">
        <div className="text-neutral-500 flex items-center gap-2 text-xs">
          Created {relativeTimeFromDates(new Date(lease.createdAt))}
          {(lease.organisationMember || lease.serviceAccount) && (
            <div className="flex items-center gap-1">
              <span className="text-neutral-500 w-4">by</span>
              <Avatar
                member={lease.organisationMember || undefined}
                serviceAccount={lease.serviceAccount || undefined}
                size="sm"
              />
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {lease.organisationMember?.self
                  ? 'You'
                  : lease.organisationMember?.fullName || lease.serviceAccount?.name}
              </span>
            </div>
          )}
        </div>
        {isRevoked ? (
          <div className="text-red-400 text-xs">
            {`${lease.status == ApiDynamicSecretLeaseStatusChoices.Expired ? 'Expire' : 'Revoke'}${isRevoked ? 'd' : 's'}`}{' '}
            {relativeTimeFromDates(new Date(lease.revokedAt))}
          </div>
        ) : (
          <div className="text-neutral-500">
            Expires {relativeTimeFromDates(new Date(lease.expiresAt))}
          </div>
        )}
      </div>
      <div className={clsx('flex flex-col gap-2 items-end', isRevoked ? 'pt-9' : '')}>
        {!isRevoked && <RenewLeaseDialog secret={secret} lease={lease} />}
        {!lease.revokedAt && <RevokeLeaseDialog secret={secret} lease={lease} />}
      </div>
    </div>
  )
}
