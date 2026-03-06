import clsx from 'clsx'

const shimmer = 'bg-zinc-300 dark:bg-zinc-700 animate-pulse rounded-full'

export const EnvironmentCardSkeleton = () => {
  return (
    <div className="group relative flex w-full h-full rounded-2xl bg-zinc-100 ring-1 ring-inset ring-neutral-500/20 dark:bg-white/2.5">
      <div className="p-3 relative rounded-2xl w-full">
        <div className="flex flex-col h-full">
          <div className="w-full min-w-0">
            <div className="flex items-center justify-between gap-2">
              {/* Environment name */}
              <div className={clsx(shimmer, 'h-5 w-3/5')} />
              {/* Settings icon */}
              <div className={clsx(shimmer, 'w-6 h-6 shrink-0')} />
            </div>
            {/* Secrets count */}
            <div className={clsx(shimmer, 'h-3.5 w-2/5 mt-2')} />
          </div>
          {/* Explore link */}
          <div className={clsx(shimmer, 'h-3.5 w-16 mt-auto pt-2')} />
        </div>
      </div>
    </div>
  )
}
