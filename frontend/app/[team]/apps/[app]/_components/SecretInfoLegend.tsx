import clsx from 'clsx'

export type SecretCellStatus = 'present' | 'sameAsProd' | 'blank' | 'missing'

/**
 * Full-cell shading for the env status cells in the cross-env table, with
 * hover variants for clickable cells.
 */
export const STATUS_CELL_STYLES: Record<SecretCellStatus, string> = {
  present: 'bg-emerald-400/20 dark:bg-emerald-400/10',
  sameAsProd: 'bg-amber-400/20 dark:bg-amber-400/10',
  blank: 'bg-zinc-400/20 dark:bg-zinc-400/10',
  missing: 'bg-red-400/10 dark:bg-red-400/5',
}

export const STATUS_CELL_HOVER_STYLES: Record<SecretCellStatus, string> = {
  present: 'hover:bg-emerald-400/30 dark:hover:bg-emerald-400/20',
  sameAsProd: 'hover:bg-amber-400/30 dark:hover:bg-amber-400/20',
  blank: 'hover:bg-zinc-400/30 dark:hover:bg-zinc-400/20',
  missing: 'hover:bg-red-400/20 dark:hover:bg-red-400/10',
}

/** Stronger static tints used to flash an env value field when it's targeted
 *  via a status-cell click in the collapsed row. */
export const STATUS_FLASH_STYLES: Record<SecretCellStatus, string> = {
  present: 'bg-emerald-400/40 dark:bg-emerald-400/20',
  sameAsProd: 'bg-amber-400/40 dark:bg-amber-400/20',
  blank: 'bg-zinc-400/40 dark:bg-zinc-400/20',
  missing: 'bg-red-400/30 dark:bg-red-400/10',
}

const Swatch = ({ status }: { status: SecretCellStatus }) => (
  <span
    aria-hidden="true"
    className={clsx(
      'w-3.5 h-3.5 rounded-sm shrink-0 ring-1 ring-inset ring-neutral-500/20',
      STATUS_CELL_STYLES[status]
    )}
  />
)

export const SecretInfoLegend = () => (
  <div className="flex items-center justify-end gap-4 p-4 text-neutral-500 text-xs whitespace-nowrap">
    <div className="flex items-center gap-1.5">
      <Swatch status="present" /> Secret is present
    </div>
    <div className="flex items-center gap-1.5">
      <Swatch status="sameAsProd" /> Secret is the same as Production
    </div>
    <div className="flex items-center gap-1.5">
      <Swatch status="blank" /> Secret is blank
    </div>
    <div className="flex items-center gap-1.5">
      <Swatch status="missing" /> Secret is missing
    </div>
  </div>
)
