import clsx from 'clsx'

export type SecretCellStatus = 'present' | 'sameAsProd' | 'blank' | 'missing'

// A faint "transparency" checkerboard: absent without shouting about it. It's a
// background-image, so hover background colors still show through.
export const MISSING_CHECKERBOARD =
  'bg-[repeating-conic-gradient(rgb(113_113_122/0.10)_0%_25%,transparent_0%_50%)] dark:bg-[repeating-conic-gradient(rgb(255_255_255/0.04)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]'

/**
 * Full-cell shading for the env status cells in the cross-env table, with
 * hover variants for clickable cells.
 */
export const STATUS_CELL_STYLES: Record<SecretCellStatus, string> = {
  present: 'bg-emerald-400/20 dark:bg-emerald-400/10',
  sameAsProd: 'bg-amber-400/20 dark:bg-amber-400/10',
  blank: 'bg-zinc-400/20 dark:bg-zinc-400/10',
  missing: MISSING_CHECKERBOARD,
}

export const STATUS_CELL_HOVER_STYLES: Record<SecretCellStatus, string> = {
  present: 'hover:bg-emerald-400/30 dark:hover:bg-emerald-400/20',
  sameAsProd: 'hover:bg-amber-400/30 dark:hover:bg-amber-400/20',
  blank: 'hover:bg-zinc-400/30 dark:hover:bg-zinc-400/20',
  missing: 'hover:bg-zinc-400/10 dark:hover:bg-zinc-400/5',
}

/** Stronger static tints used to flash an env value field when it's targeted
 *  via a status-cell click in the collapsed row. */
export const STATUS_FLASH_STYLES: Record<SecretCellStatus, string> = {
  present: 'bg-emerald-400/40 dark:bg-emerald-400/20',
  sameAsProd: 'bg-amber-400/40 dark:bg-amber-400/20',
  blank: 'bg-zinc-400/40 dark:bg-zinc-400/20',
  missing: 'bg-zinc-400/30 dark:bg-zinc-400/15',
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
