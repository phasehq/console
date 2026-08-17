import clsx from 'clsx'
import { LogoMark } from './LogoMark'

/**
 * Renders the actor chip for events without a user / service account —
 * i.e. anything driven by the rotation or dynamic-secret engine. The
 * circle wrapper matches `Avatar`'s shape and sizing so rows align with
 * regular Avatar + username rows.
 */
export const PhaseActor = ({
  size = 'sm',
  className,
}: {
  size?: 'sm' | 'md'
  className?: string
}) => {
  const logoSize = size === 'sm' ? 'h-6 w-6' : 'h-9 w-9'
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm'

  return (
    <div
      className={clsx('flex items-center gap-0.5 font-medium', textSize, className)}
      title="Triggered by the Phase engine"
    >
      <LogoMark className={clsx(logoSize, 'shrink-0 fill-zinc-900 dark:fill-zinc-100')} />
      <span>phase</span>
    </div>
  )
}
