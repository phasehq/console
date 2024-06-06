import { ActivatedPhaseLicenseType, PhaseLicenseType, PlanTier } from '@/apollo/graphql'
import { relativeTimeFromDates } from '@/utils/time'
import clsx from 'clsx'
import { MdVerified } from 'react-icons/md'

export const License = (props: {
  license: PhaseLicenseType | ActivatedPhaseLicenseType
  showExpiry: boolean
}) => {
  const { license, showExpiry } = props

  const planString = () => {
    if (license.plan === PlanTier.EnterprisePlan || license.plan === 'EN') return 'Enterprise'
    else if (license.plan === PlanTier.ProPlan || license.plan === 'PR') return 'Pro'
    else return license.plan
  }

  const isExpired = () => new Date() > new Date(license.expiresAt)

  return (
    <div
      className={clsx(
        'ring-1 ring-inset  rounded-lg p-4 w-full flex items-center justify-between gap-4',
        isExpired()
          ? 'ring-red-400/20 bg-red-400/20 dark:bg-red-400/10'
          : 'ring-emerald-400/20 bg-emerald-400/20 dark:bg-emerald-400/10'
      )}
    >
      <MdVerified
        className={clsx('text-2xl shrink-0', isExpired() ? 'text-red-400' : 'text-emerald-400')}
      />
      <div className="w-full">
        <div className="flex items-center gap-2 text-lg font-semibold">Phase {planString()}</div>
        <div className="font-mono text-neutral-500 text-sm">{license.id}</div>
      </div>
      <div className="text-neutral-500 w-full flex flex-col items-end">
        <div>
          Issued to{' '}
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {license.customerName}
          </span>
        </div>
        {showExpiry && (
          <div className={clsx('text-xs', isExpired() && 'text-red-400')}>
            {isExpired() ? 'Expired' : 'Valid till'}{' '}
            {relativeTimeFromDates(new Date(license.expiresAt))}
          </div>
        )}
      </div>
    </div>
  )
}
