import {
  ActivatedPhaseLicenseType,
  ApiOrganisationPlanChoices,
  PhaseLicenseType,
  PlanTier,
} from '@/apollo/graphql'
import { relativeTimeFromDates } from '@/utils/time'
import { MdVerified } from 'react-icons/md'

export const License = (props: { license: PhaseLicenseType | ActivatedPhaseLicenseType }) => {
  const { license } = props

  const planString = () => {
    if (license.plan === PlanTier.EnterprisePlan || license.plan === 'EN') return 'Enterprise'
    else if (license.plan === PlanTier.ProPlan || license.plan === 'PR') return 'Pro'
    else return license.plan
  }

  return (
    <div className="ring-1 ring-inset ring-emerald-400/20 bg-emerald-400/10 rounded-lg p-4 w-full flex items-center justify-between gap-4">
      <MdVerified className="text-emerald-400 text-2xl shrink-0" />
      <div className="w-full">
        <div className="flex items-center gap-2 text-lg font-semibold">
          Phase {planString()} License
        </div>
        <div className="font-mono text-neutral-500 text-sm">{license.id}</div>
      </div>
      <div className="text-neutral-500 w-full flex flex-col items-end">
        <div>
          Issued to{' '}
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {license.customerName}
          </span>
        </div>
        <div className="text-xs">Expires {relativeTimeFromDates(new Date(license.expiresAt))}</div>
      </div>
    </div>
  )
}
