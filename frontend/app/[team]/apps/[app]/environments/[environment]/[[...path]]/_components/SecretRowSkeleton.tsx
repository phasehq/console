import clsx from 'clsx'

const shimmer = 'bg-zinc-300 dark:bg-zinc-700 animate-pulse rounded-full'

interface SecretRowSkeletonProps {
  index: number
}

export const SecretRowSkeleton = ({ index }: SecretRowSkeletonProps) => {
  return (
    <div className="flex items-start gap-2 py-1 px-3 rounded-md">
      {/* Row number */}
      <div className="text-neutral-500 font-mono w-5 h-10 flex items-center">{index + 1}</div>
      {/* Secret row content */}
      <div className="flex-1 flex items-center gap-4 py-2">
        {/* Key column */}
        <div className="w-1/3">
          <div className={clsx(shimmer, 'h-5 w-32')} />
        </div>
        {/* Value column */}
        <div className="w-2/3 flex items-center gap-2">
          <div className={clsx(shimmer, 'h-5 flex-1 max-w-md')} />
        </div>
      </div>
    </div>
  )
}
