import { ApiOrganisationPlanChoices } from '@/apollo/graphql'
import clsx from 'clsx'

export const PlanLabel = (props: { plan: ApiOrganisationPlanChoices }) => {
  const planStyle = () => {
    if (props.plan === ApiOrganisationPlanChoices.Fr)
      return 'ring-neutral-500/40 bg-neutral-500/40 text-black dark:bg-zinc-800 dark:text-neutral-500'
    if (props.plan === ApiOrganisationPlanChoices.Pr)
      return 'ring-emerald-400/10 bg-emerald-400 text-black dark:bg-zinc-800 dark:text-emerald-400'
    if (props.plan === ApiOrganisationPlanChoices.En)
      return 'ring-amber-400/10 bg-amber-400 text-black dark:bg-zinc-800 dark:text-amber-400'
  }

  const planDisplay = () => {
    if (props.plan === ApiOrganisationPlanChoices.Fr) return 'Free'
    if (props.plan === ApiOrganisationPlanChoices.Pr) return 'Pro'
    if (props.plan === ApiOrganisationPlanChoices.En) return 'Enterprise'
  }

  return (
    <span
      className={clsx(
        'px-2 py-1 rounded-full ring-1 ring-inset uppercase text-2xs font-medium tracking-wide',
        planStyle()
      )}
    >
      {planDisplay()}
    </span>
  )
}
