import clsx from 'clsx'

const shimmer = 'bg-zinc-300 dark:bg-zinc-700 animate-pulse rounded-full'

interface AppSecretRowSkeletonProps {
  index: number
  envCount?: number
}

export const AppSecretRowSkeleton = ({ index, envCount = 3 }: AppSecretRowSkeletonProps) => {
  return (
    <tr className="group divide-x divide-neutral-500/20 border-l border-neutral-500/20 bg-zinc-100 dark:bg-zinc-800">
      <td className="px-2 py-0.5 whitespace-nowrap font-mono flex items-center gap-2">
        {/* Row number */}
        <span className="text-neutral-500 font-mono text-2xs w-4 text-center">{index + 1}</span>
        {/* Secret key - min-w and h-7 match the input element height in AppSecretRow */}
        <div className="relative flex-1 min-w-60 md:min-w-80">
          <div className={clsx(shimmer, 'h-7 w-36')} />
        </div>
      </td>
      {/* Environment status cells */}
      {[...Array(envCount)].map((_, i) => (
        <td key={i} className="px-2 whitespace-nowrap">
          <div className="h-7 my-0.5 rounded-sm bg-zinc-300/60 dark:bg-zinc-700/60 animate-pulse" />
        </td>
      ))}
    </tr>
  )
}
