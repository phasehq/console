'use client'

import clsx from 'clsx'

const shimmer = 'bg-zinc-300 dark:bg-zinc-700 animate-pulse'

interface MemberRowSkeletonProps {
  showEmail?: boolean
  showManageButton?: boolean
}

const MemberRowSkeleton = ({ showEmail = true, showManageButton = true }: MemberRowSkeletonProps) => {
  return (
    <tr>
      <td className="py-2">
        <div className="flex items-center gap-2">
          {/* Avatar */}
          <div className={clsx('h-8 w-8 rounded-full shrink-0', shimmer)} />
          <div className="space-y-1.5">
            {/* Name */}
            <div className={clsx('h-4 w-32 rounded', shimmer)} />
            {/* Email/ID */}
            {showEmail && <div className={clsx('h-3 w-40 rounded', shimmer)} />}
          </div>
        </div>
      </td>
      <td className="px-6 py-2">
        {/* Role badge */}
        <div className={clsx('h-5 w-20 rounded-md', shimmer)} />
      </td>
      <td className="px-6 py-2">
        {/* Timestamp */}
        <div className={clsx('h-4 w-24 rounded', shimmer)} />
      </td>
      {showManageButton && (
        <td className="px-6 py-2 text-right">
          {/* Manage button */}
          <div className={clsx('h-8 w-24 rounded-lg ml-auto', shimmer)} />
        </td>
      )}
    </tr>
  )
}

interface MemberListSkeletonProps {
  count?: number
  showEmail?: boolean
  showManageButton?: boolean
}

export const MemberListSkeleton = ({
  count = 10,
  showEmail = true,
  showManageButton = true,
}: MemberListSkeletonProps) => {
  return (
    <table className="table-auto min-w-full divide-y divide-zinc-500/40">
      <thead>
        <tr>
          <th className="py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            <div className={clsx('h-3 w-12 rounded', shimmer)} />
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            <div className={clsx('h-3 w-10 rounded', shimmer)} />
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            <div className={clsx('h-3 w-16 rounded', shimmer)} />
          </th>
          {showManageButton && <th className="px-6 py-3"></th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-500/20">
        {[...Array(count)].map((_, index) => (
          <MemberRowSkeleton
            key={index}
            showEmail={showEmail}
            showManageButton={showManageButton}
          />
        ))}
      </tbody>
    </table>
  )
}
