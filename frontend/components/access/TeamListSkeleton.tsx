'use client'

import clsx from 'clsx'

const shimmer = 'bg-zinc-300 dark:bg-zinc-700 animate-pulse'

const TeamRowSkeleton = () => (
  <tr>
    <td className="py-2 pr-4 max-w-xs">
      <div className="space-y-1.5">
        {/* Team name */}
        <div className={clsx('h-4 w-40 rounded', shimmer)} />
        {/* Description */}
        <div className={clsx('h-3 w-56 rounded', shimmer)} />
      </div>
    </td>
    <td className="px-4 py-2">
      <div className="space-y-1.5">
        {/* Member count line */}
        <div className={clsx('h-3 w-28 rounded', shimmer)} />
        {/* SA count line */}
        <div className={clsx('h-3 w-32 rounded', shimmer)} />
      </div>
    </td>
    <td className="px-4 py-2">
      {/* App count */}
      <div className={clsx('h-4 w-6 rounded', shimmer)} />
    </td>
    <td className="px-4 py-2 text-right">
      {/* Manage button */}
      <div className={clsx('h-8 w-24 rounded-lg ml-auto', shimmer)} />
    </td>
  </tr>
)

export const TeamListSkeleton = ({ count = 8 }: { count?: number }) => (
  <table className="table-auto min-w-full divide-y divide-zinc-500/40">
    <thead>
      <tr>
        <th className="py-3 text-left">
          <div className={clsx('h-3 w-12 rounded', shimmer)} />
        </th>
        <th className="px-4 py-3 text-left">
          <div className={clsx('h-3 w-16 rounded', shimmer)} />
        </th>
        <th className="px-4 py-3 text-left">
          <div className={clsx('h-3 w-10 rounded', shimmer)} />
        </th>
        <th className="px-4 py-3"></th>
      </tr>
    </thead>
    <tbody className="divide-y divide-zinc-500/20">
      {[...Array(count)].map((_, i) => (
        <TeamRowSkeleton key={i} />
      ))}
    </tbody>
  </table>
)
