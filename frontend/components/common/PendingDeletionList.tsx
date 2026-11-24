'use client'

import { useRef, useState } from 'react'
import clsx from 'clsx'
import { FaClock, FaTrash, FaUndo } from 'react-icons/fa'
import { Alert } from './Alert'
import { Button } from './Button'
import GenericDialog from './GenericDialog'
import Spinner from './Spinner'
import { formatDeletionDate } from '@/utils/organisation'

export type PendingDeletion = {
  id: string
  name: string
  deletionScheduledFor: string
  /** A credential that can't be revoked holds up the deletion. */
  deletionDelayed: boolean
  canRestore: boolean
}

/** Past restoring: a background job is deleting it, or about to. */
export const isBeingDeleted = (item: Pick<PendingDeletion, 'canRestore' | 'deletionDelayed'>) =>
  !item.canRestore && !item.deletionDelayed

export const deletionStatus = (item: PendingDeletion) => {
  if (item.deletionDelayed) return "Deletion delayed: Phase couldn't revoke some credentials"
  if (item.canRestore) return `Will be deleted on ${formatDeletionDate(item.deletionScheduledFor)}`
  return 'Being deleted'
}

/** A red clock while it waits for its date, the amber spinner of a running sync once it is being deleted. */
export const StatusLine = ({ item }: { item: PendingDeletion }) => {
  const beingDeleted = isBeingDeleted(item)

  return (
    <div
      className={clsx(
        'flex items-center gap-1.5 text-xs',
        beingDeleted ? 'text-amber-500' : 'text-red-500'
      )}
    >
      {beingDeleted ? <Spinner size="xs" color="amber" /> : <FaClock className="shrink-0" />}
      <span>{deletionStatus(item)}</span>
    </div>
  )
}

/** Asks before giving up the rest of the time in which the item can be restored. */
export const DeleteNowDialog = ({
  item,
  kind,
  disabled,
  onConfirm,
}: {
  item: PendingDeletion
  kind: string
  disabled: boolean
  onConfirm: (item: PendingDeletion) => Promise<void>
}) => {
  const dialogRef = useRef<{ closeModal: () => void }>(null)
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await onConfirm(item)
      dialogRef.current?.closeModal()
    } finally {
      setLoading(false)
    }
  }

  return (
    <GenericDialog
      title={`Delete ${item.name} now`}
      buttonContent="Delete now"
      buttonVariant="danger"
      buttonProps={{ icon: FaTrash, disabled }}
      size="sm"
      ref={dialogRef}
    >
      <div className="space-y-4 pt-2">
        <Alert variant="danger" size="sm">
          <div className="space-y-1">
            <p className="font-bold">This {kind} will be deleted immediately</p>
            <p>It can no longer be restored. This cannot be undone.</p>
          </div>
        </Alert>
        <div className="flex items-center justify-between gap-4">
          <Button
            variant="secondary"
            onClick={() => dialogRef.current?.closeModal()}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button variant="danger" icon={FaTrash} isLoading={loading} onClick={handleConfirm}>
            Delete now
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}

/** Apps or environments that are scheduled for deletion. Each can be restored, or deleted now. */
export const PendingDeletionList = <T extends PendingDeletion>({
  kind,
  description,
  items,
  allowRestore,
  restoringId,
  onRestore,
  onDeleteNow,
}: {
  /** What an item is called in the confirmation, e.g. "App". */
  kind: string
  description: string
  items: T[]
  /** Whoever may delete an item may restore it, or delete it now. */
  allowRestore: (item: T) => boolean
  restoringId?: string | null
  onRestore: (item: PendingDeletion) => void
  onDeleteNow: (item: PendingDeletion) => Promise<void>
}) => {
  if (items.length === 0) return <></>

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-black dark:text-white">Scheduled for deletion</h2>
        <p className="text-neutral-500 text-xs">{description}</p>
      </div>
      <ul className="divide-y divide-neutral-500/20 rounded-lg ring-1 ring-inset ring-neutral-500/20">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-4 p-3">
            <div className="min-w-0 space-y-0.5">
              <div className="font-medium text-sm truncate text-black dark:text-white">
                {item.name}
              </div>
              <StatusLine item={item} />
            </div>
            {item.canRestore && allowRestore(item) && (
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="secondary"
                  icon={FaUndo}
                  isLoading={restoringId === item.id}
                  disabled={!!restoringId}
                  onClick={() => onRestore(item)}
                >
                  Restore
                </Button>
                {/* A delayed deletion is already past its time: there is nothing to bring forward. */}
                {!item.deletionDelayed && (
                  <DeleteNowDialog
                    item={item}
                    kind={kind}
                    disabled={!!restoringId}
                    onConfirm={onDeleteNow}
                  />
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
