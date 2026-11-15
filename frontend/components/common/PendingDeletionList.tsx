'use client'

import { FaClock, FaUndo } from 'react-icons/fa'
import { Button } from './Button'
import { formatDeletionDate } from '@/utils/organisation'

export type PendingDeletion = {
  id: string
  name: string
  deletionScheduledFor: string
  canRestore: boolean
}

/** Apps or environments that are scheduled for deletion, each with a restore action. */
export const PendingDeletionList = ({
  description,
  items,
  allowRestore,
  restoringId,
  onRestore,
}: {
  description: string
  items: PendingDeletion[]
  allowRestore: boolean
  restoringId?: string | null
  onRestore: (item: PendingDeletion) => void
}) => {
  if (items.length === 0) return <></>

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-black dark:text-white">
          Scheduled for deletion
        </h2>
        <p className="text-neutral-500 text-xs">{description}</p>
      </div>
      <ul className="divide-y divide-neutral-500/20 rounded-lg ring-1 ring-inset ring-neutral-500/20">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-4 p-3">
            <div className="min-w-0 space-y-0.5">
              <div className="font-medium text-sm truncate text-black dark:text-white">
                {item.name}
              </div>
              <div className="flex items-center gap-1.5 text-red-500 text-xs">
                <FaClock className="shrink-0" />
                <span>
                  {item.canRestore
                    ? `Will be deleted on ${formatDeletionDate(item.deletionScheduledFor)}`
                    : 'Being deleted'}
                </span>
              </div>
            </div>
            {item.canRestore && allowRestore && (
              <Button
                variant="secondary"
                icon={FaUndo}
                isLoading={restoringId === item.id}
                disabled={!!restoringId}
                onClick={() => onRestore(item)}
              >
                Restore
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
