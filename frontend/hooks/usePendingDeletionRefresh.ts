import { useEffect, useState } from 'react'
import { isBeingDeleted, PendingDeletion } from '@/components/common/PendingDeletionList'

const DELETING_POLL_MS = 5000
const SLOW_POLL_MS = 60000

const deadline = (item: PendingDeletion) => new Date(item.deletionScheduledFor).getTime()

/**
 * Keeps a list of apps or environments that are scheduled for deletion current
 * on a page that stays open. A background job deletes them, so the list changes
 * without the page doing anything.
 */
export const usePendingDeletionRefresh = (
  items: PendingDeletion[],
  query: {
    refetch: () => unknown
    startPolling: (interval: number) => void
    stopPolling: () => void
  }
) => {
  const { refetch, startPolling, stopPolling } = query
  const [, setDeadlinesPassed] = useState(0)

  const restorable = items.filter((item) => item.canRestore && !item.deletionDelayed)
  const now = Date.now()

  // An item can no longer be restored once its time is up: ask again then.
  const nextDeadline = restorable
    .map(deadline)
    .filter((time) => time > now)
    .reduce((earliest, time) => Math.min(earliest, time), Infinity)
  useEffect(() => {
    if (!Number.isFinite(nextDeadline)) return
    const timer = setTimeout(
      () => {
        refetch()
        setDeadlinesPassed((count) => count + 1)
      },
      nextDeadline - Date.now() + 1000
    )
    return () => clearTimeout(timer)
  }, [nextDeadline, refetch])

  // Watch for an item to leave the list: one being deleted, or one whose
  // delayed deletion is retried every hour. Also for one the server still
  // calls restorable past its time, when this clock runs ahead of it.
  const deleting = items.some(isBeingDeleted)
  const delayed = items.some((item) => item.deletionDelayed)
  const overdue = restorable.some((item) => deadline(item) <= now)
  useEffect(() => {
    if (!deleting && !delayed && !overdue) return
    startPolling(deleting ? DELETING_POLL_MS : SLOW_POLL_MS)
    return () => stopPolling()
  }, [deleting, delayed, overdue, startPolling, stopPolling])
}
