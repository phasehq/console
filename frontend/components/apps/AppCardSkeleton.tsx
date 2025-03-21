// AppCardSkeleton.tsx

import React from 'react'
import { clsx } from 'clsx'

interface AppCardSkeletonProps {
  variant: 'normal' | 'compact'
}

const shimmer = 'bg-zinc-300 dark:bg-zinc-700 animate-pulse rounded-full'

const AppCardSkeleton = ({ variant }: AppCardSkeletonProps) => {
  const AppMetaRow = () => {
    return (
      <div
        className={clsx(
          'col-span-5 hidden lg:grid  justify-stretch  w-full',
          'rounded',
          variant === 'normal' ? 'grid-cols-4' : 'grid-cols-5'
        )}
      >
        {[...Array(4)].map((_, index) => (
          <div key={index} className="flex items-center ">
            <div className={`h-6`} />
            {[...Array(5)].map((_, idx) => (
              <div key={idx} className={`size-8 ${shimmer} ${idx === 0 ? '' : '-ml-3'}`} />
            ))}
          </div>
        ))}

        {variant === 'compact' && <div className={clsx('w-16 h-4', shimmer)}></div>}
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'flex w-full',
        variant === 'normal'
          ? 'flex-col gap-24 justify-between rounded-xl ring-1 ring-neutral-500/40 p-3'
          : 'gap-6 lg:gap-10 grid grid-cols-2 lg:grid-cols-7 justify-stretch items-center py-4'
      )}
    >
      <div
        className={clsx(
          'flex justify-between',
          variant === 'normal'
            ? 'items-start'
            : 'items-center col-span-2 w-full lg:max-w-[24rem] gap-4'
        )}
      >
        <div className="space-y-0.5 w-full">
          <div
            className={clsx(
              shimmer,
              'h-6',
              variant === 'normal' ? 'text-2xl w-40' : 'text-lg pl-3'
            )}
          />
          {variant === 'normal' ? (
            <div className={clsx('text-2xs font-mono h-4 w-80', shimmer)}></div>
          ) : (
            <div className="flex items-center justify-between">
              <div></div>
              <div className="lg:hidden">
                <CondensedAppMetaCounts />
              </div>
            </div>
          )}
        </div>
        <div className="hidden xl:block">
          <div className={clsx('w-16 h-4', shimmer)}></div>
        </div>
      </div>

      {variant === 'normal' ? (
        <div className="flex items-center justify-between py-2 gap-6">
          <AppMetaRow />
        </div>
      ) : (
        <AppMetaRow />
      )}
    </div>
  )
}

const CondensedAppMetaCounts = () => {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 text-xs text-neutral-500 h-4 "></div>
      <div className="flex items-center gap-1 text-xs text-neutral-500 h-4 "></div>
      <div className="flex items-center gap-1 text-xs text-neutral-500 h-4 "></div>
      <div className="flex items-center gap-1 text-xs text-neutral-500 h-4 "></div>
    </div>
  )
}

export default AppCardSkeleton
