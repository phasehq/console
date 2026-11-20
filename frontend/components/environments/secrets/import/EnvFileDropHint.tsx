import { ReactNode } from 'react'
import { TbDownload } from 'react-icons/tb'

/** Covers its positioned parent while a file is dragged across it */
export const EnvFileDropHint = ({ children }: { children: ReactNode }) => (
  <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-md border-2 border-dashed border-emerald-500/70 bg-zinc-100/80 dark:bg-zinc-900/80">
    <div className="flex items-center gap-2 rounded-md bg-zinc-100 px-4 py-3 text-sm font-medium text-emerald-700 shadow-lg ring-1 ring-inset ring-emerald-500/30 dark:bg-zinc-900 dark:text-emerald-400">
      <TbDownload className="shrink-0 text-xl" />
      {children}
    </div>
  </div>
)
