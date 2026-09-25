import clsx from 'clsx'

/**
 * Release-stage pill, e.g. Beta.
 *
 * Kept as a separate element rather than baked into a name string: navigation
 * labels are reused as tab labels, tooltips and aria-labels, and a suffix in
 * the string degrades all of them at once.
 */
export const StageBadge = ({ stage, className }: { stage: string; className?: string }) => (
  <span
    className={clsx(
      // Deliberately plainer and smaller than PlanLabel: a stage marker is an
      // aside, not a tier, and the two must not read as the same kind of pill.
      'px-1 py-0.5 rounded uppercase text-[10px] leading-none font-medium tracking-wide',
      'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300',
      className
    )}
  >
    {stage}
  </span>
)
