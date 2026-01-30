import clsx from 'clsx'
import { SecretRowSkeleton } from './SecretRowSkeleton'

const shimmer = 'bg-zinc-300 dark:bg-zinc-700 animate-pulse rounded-full'

export const EnvironmentPageSkeleton = () => {
  return (
    <div className="h-full max-h-screen overflow-y-auto w-full text-black dark:text-white">
      <div className="flex flex-col py-4 bg-zinc-200 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center gap-8 justify-between w-full">
          <div className="flex items-center gap-8">
            {/* Environment name */}
            <div className={clsx(shimmer, 'h-7 w-32')} />
            {/* Breadcrumb */}
            <div className="flex items-center gap-2">
              <div className={clsx(shimmer, 'h-5 w-8')} />
            </div>
          </div>
        </div>

        {/* Controls bar */}
        <div className="space-y-0 sticky top-0 z-5 bg-zinc-200/50 dark:bg-zinc-900/50 backdrop-blur">
          <div className="flex items-center w-full justify-between border-b border-zinc-300 dark:border-zinc-700 py-4">
            <div className="flex items-center gap-4">
              {/* Search input */}
              <div className={clsx(shimmer, 'h-9 w-48')} />
              {/* Sort button */}
              <div className={clsx(shimmer, 'h-9 w-32')} />
            </div>

            <div className="flex gap-2 items-center">
              {/* Deploy button */}
              <div className={clsx(shimmer, 'h-9 w-28')} />
            </div>
          </div>

          {/* Table header */}
          <div className="flex items-center w-full">
            <div className="px-9 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider w-1/3">
              key
            </div>
            <div className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider w-2/3 flex items-center justify-between">
              value
              <div className="flex items-center gap-4">
                {/* Reveal all button */}
                <div className={clsx(shimmer, 'h-8 w-24')} />
                {/* Export button */}
                <div className={clsx(shimmer, 'h-8 w-32')} />
                {/* New secret button */}
                <div className={clsx(shimmer, 'h-8 w-28')} />
              </div>
            </div>
          </div>
        </div>

        {/* Secret rows */}
        <div className="flex flex-col gap-0 divide-y divide-neutral-500/20 bg-zinc-100 dark:bg-zinc-800 rounded-md shadow-md">
          {[...Array(13)].map((_, index) => (
            <SecretRowSkeleton key={`skeleton-${index}`} index={index} />
          ))}
        </div>
      </div>
    </div>
  )
}
