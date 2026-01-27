import clsx from 'clsx'

const shimmer = 'bg-zinc-300 dark:bg-zinc-700 animate-pulse rounded-full'

interface AppSecretRowSkeletonProps {
  index: number
  envCount?: number
}

export const AppSecretRowSkeleton = ({ index, envCount = 3 }: AppSecretRowSkeletonProps) => {
  return (
    <tr className="group divide-x divide-neutral-500/20 border-l border-neutral-500/20 bg-zinc-100 dark:bg-zinc-800">
      <td className="px-2 py-2 whitespace-nowrap font-mono flex items-center gap-2">
        {/* Row number */}
        <span className="text-neutral-500 font-mono w-5 text-center">{index + 1}</span>
        {/* Secret key */}
        <div className="relative flex-1 min-w-60 md:min-w-80">
          <div className={clsx(shimmer, 'h-5 w-36')} />
        </div>
      </td>
      {/* Environment status indicators */}
      {[...Array(envCount)].map((_, i) => (
        <td key={i} className="px-6 py-2 whitespace-nowrap">
          <div className="flex items-center justify-center">
            <div className={clsx(shimmer, 'w-4 h-4')} />
          </div>
        </td>
      ))}
    </tr>
  )
}
