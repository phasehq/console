const DOT_BASE = 'w-2 h-2 rounded-full shrink-0'

export const PresentIndicator = () => (
  <span aria-hidden="true" className={`${DOT_BASE} bg-emerald-500`} />
)
export const SameAsProdIndicator = () => (
  <span aria-hidden="true" className={`${DOT_BASE} bg-amber-500`} />
)
export const BlankIndicator = () => (
  <span aria-hidden="true" className={`${DOT_BASE} bg-neutral-400 dark:bg-neutral-500`} />
)
export const MissingIndicator = () => (
  <span aria-hidden="true" className={`${DOT_BASE} ring-2 ring-red-500 ring-inset`} />
)

export const SecretInfoLegend = () => (
  <div className="flex items-center justify-end gap-4 p-4 text-neutral-500 text-xs whitespace-nowrap">
    <div className="flex items-center gap-1.5">
      <PresentIndicator /> Secret is present
    </div>
    <div className="flex items-center gap-1.5">
      <SameAsProdIndicator /> Secret is the same as Production
    </div>
    <div className="flex items-center gap-1.5">
      <BlankIndicator /> Secret is blank
    </div>
    <div className="flex items-center gap-1.5">
      <MissingIndicator /> Secret is missing
    </div>
  </div>
)
