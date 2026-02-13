export const SecretInfoLegend = () => (
  <div className="flex items-center justify-end gap-4 p-4 text-neutral-500 text-xs whitespace-nowrap">
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-emerald-500" /> Secret is present
    </div>
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-amber-500" /> Secret is the same as Production
    </div>
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-neutral-400 dark:bg-neutral-500" /> Secret is blank
    </div>
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full ring-2 ring-red-500 ring-inset" /> Secret is missing
    </div>
  </div>
)
