import clsx from 'clsx'

/**
 * Marks the sign-in method used last on this browser. `inverse` sits on a
 * filled (primary) button.
 */
export function LastUsedBadge({
  tone = 'default',
  className,
}: {
  tone?: 'default' | 'inverse'
  className?: string
}) {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center rounded-full px-2 text-2xs font-medium leading-5 ring-1 ring-inset',
        tone === 'default'
          ? 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/20'
          : 'bg-white/15 text-white ring-white/20 dark:bg-emerald-400/15 dark:text-emerald-300 dark:ring-emerald-400/30',
        className
      )}
    >
      Last used
    </span>
  )
}
