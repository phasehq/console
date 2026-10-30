import clsx from 'clsx'
import { GRID_CELL_BASE, GRID_KEY_CELL, GRID_ROW_BG, GRID_TRAILING_CELL } from './gridColumns'

const shimmer = 'bg-zinc-300 dark:bg-zinc-700 animate-pulse rounded-full'

interface AppSecretRowSkeletonProps {
  index: number
  envCount?: number
}

export const AppSecretRowSkeleton = ({ index, envCount = 3 }: AppSecretRowSkeletonProps) => {
  return (
    <tr className="bg-zinc-100 dark:bg-zinc-800">
      <td className={clsx(GRID_CELL_BASE, GRID_KEY_CELL, GRID_ROW_BG)}>
        <div className="flex items-center gap-2 px-2 py-0.5">
          <span className="w-6 text-right font-mono text-2xs text-neutral-500">{index + 1}</span>
          {/* h-7 matches the key input height */}
          <div className={clsx(shimmer, 'my-0.5 h-7 w-36')} />
        </div>
      </td>
      {[...Array(envCount)].map((_, i) => (
        <td key={i} className={clsx(GRID_CELL_BASE, 'px-2')}>
          <div className="my-0.5 h-7 animate-pulse rounded-sm bg-zinc-300/60 dark:bg-zinc-700/60" />
        </td>
      ))}
      <td className={clsx(GRID_CELL_BASE, GRID_TRAILING_CELL, GRID_ROW_BG)} />
    </tr>
  )
}
