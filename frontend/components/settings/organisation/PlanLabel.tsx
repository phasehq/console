import { ApiOrganisationPlanChoices } from '@/apollo/graphql'
import clsx from 'clsx'

export const PlanLabel = (props: { plan: ApiOrganisationPlanChoices }) => {
  const planStyle = () => {
    if (props.plan === ApiOrganisationPlanChoices.Fr)
      return 'ring-neutral-500/40 bg-neutral-500/40 text-zinc-900 dark:bg-zinc-800 dark:text-neutral-500'
    if (props.plan === ApiOrganisationPlanChoices.Pr)
      return 'ring-emerald-400/10 bg-emerald-400 text-zinc-900 dark:bg-emerald-400/10 dark:text-emerald-400'
    if (props.plan === ApiOrganisationPlanChoices.En)
      return 'ring-amber-400/10 bg-amber-400 text-zinc-900 dark:bg-amber-400/10 dark:text-amber-400'
  }

  const planDisplay = () => {
    if (props.plan === ApiOrganisationPlanChoices.Fr) return 'Free'
    if (props.plan === ApiOrganisationPlanChoices.Pr) return 'Pro'
    if (props.plan === ApiOrganisationPlanChoices.En) return 'Enterprise'
  }

  return (
    <span
      className={clsx(
        'px-2 py-0.5 rounded-md uppercase text-2xs font-semibold font-mono tracking-wide',
        planStyle()
      )}
    >
      {planDisplay()}
    </span>
  )
}
