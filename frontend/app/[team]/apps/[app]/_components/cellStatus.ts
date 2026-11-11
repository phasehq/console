export type SecretCellStatus = 'present' | 'blank' | 'missing'

// A faint "transparency" checkerboard: absent without shouting about it. It's a
// background-image, so hover background colors still show through.
export const MISSING_CHECKERBOARD =
  'bg-[repeating-conic-gradient(rgb(113_113_122/0.10)_0%_25%,transparent_0%_50%)] dark:bg-[repeating-conic-gradient(rgb(255_255_255/0.04)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]'

/** Full-cell shading for an env's value cell */
export const STATUS_CELL_STYLES: Record<SecretCellStatus, string> = {
  present: 'bg-emerald-400/20 dark:bg-emerald-400/10',
  blank: 'bg-zinc-400/20 dark:bg-zinc-400/10',
  missing: MISSING_CHECKERBOARD,
}

/** Stronger tints that flash a value cell when it's the target of a jump */
export const STATUS_FLASH_STYLES: Record<SecretCellStatus, string> = {
  present: 'bg-emerald-400/40 dark:bg-emerald-400/20',
  blank: 'bg-zinc-400/40 dark:bg-zinc-400/20',
  missing: 'bg-zinc-400/30 dark:bg-zinc-400/15',
}

/** Edit tints arrive quickly and leave slowly: a transition takes its duration from the state it's heading to */
export const tintFade = (tinted: boolean) => (tinted ? 'duration-200' : 'duration-700')
