import clsx from 'clsx'

const shimmer = 'bg-zinc-300 dark:bg-zinc-700 animate-pulse rounded-full'

export const EnvironmentCardSkeleton = () => {
  return (
    <div className="group relative flex w-full h-full rounded-2xl bg-zinc-100 ring-1 ring-inset ring-neutral-500/20 dark:bg-white/2.5">
      <div className="p-4 relative rounded-2xl w-full">
        <div className="flex gap-2 xl:gap-4">
          {/* Icon placeholder */}
          <div className="pt-1.5">
            <div className={clsx(shimmer, 'w-5 h-5')} />
          </div>
          <div className="space-y-6 w-full min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-2">
                {/* Environment name */}
                <div className={clsx(shimmer, 'h-5 w-28')} />
                {/* Secrets count */}
                <div className={clsx(shimmer, 'h-4 w-20')} />
              </div>
              {/* Settings icon placeholder */}
              <div className={clsx(shimmer, 'w-6 h-6')} />
            </div>

            {/* Explore button */}
            <div className={clsx(shimmer, 'h-8 w-20')} />
          </div>
        </div>
      </div>
    </div>
  )
}
