import clsx from 'clsx'
import { FaPlus } from 'react-icons/fa'
import { MISSING_CHECKERBOARD } from './SecretInfoLegend'

const CELL = 'flex h-full min-h-9 w-full items-center px-3 py-1'

// The hollow ring that marks "missing" across the grid, slim columns included
const MissingMarker = ({ className }: { className?: string }) => (
  <span
    aria-hidden
    className={clsx('h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-neutral-500/50', className)}
  />
)

/**
 * The one look for anything absent from an env — a value, a folder, a dynamic
 * key: a faint checkerboard and a quiet ring. Where there's an action, the whole
 * cell is its button and the label shows on hover or focus.
 */
export const MissingCell = ({
  actionLabel,
  onAction,
  disabled,
  title,
  className,
}: {
  actionLabel?: string
  onAction?: () => void
  disabled?: boolean
  title?: string
  className?: string
}) => {
  if (!onAction || !actionLabel || disabled)
    return (
      <div className={clsx(CELL, MISSING_CHECKERBOARD, className)} title={title}>
        <MissingMarker />
      </div>
    )

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onAction()
      }}
      title={title}
      aria-label={actionLabel}
      className={clsx(
        CELL,
        MISSING_CHECKERBOARD,
        'group/missing text-left text-2xs text-neutral-500 transition-colors hover:bg-zinc-300/50 hover:text-zinc-900 focus:outline-none focus-visible:bg-zinc-300/50 dark:hover:bg-zinc-700/50 dark:hover:text-zinc-100 dark:focus-visible:bg-zinc-700/50',
        className
      )}
    >
      <MissingMarker className="group-hover/missing:hidden group-focus-visible/missing:hidden" />
      <span className="hidden items-center gap-1.5 group-hover/missing:flex group-focus-visible/missing:flex">
        <FaPlus className="shrink-0 text-[9px]" />
        {actionLabel}
      </span>
    </button>
  )
}
