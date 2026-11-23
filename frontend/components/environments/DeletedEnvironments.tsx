'use client'

import { DeletedEnvironmentType } from '@/apollo/graphql'
import { PendingDeletion, PendingDeletionList } from '@/components/common/PendingDeletionList'
import { DELETION_GRACE_PERIOD } from '@/constants'

/**
 * The app's environments that are scheduled for deletion, as a list. Each can be restored, or
 * deleted now. For where the secrets grid isn't shown: its struck-out columns do the same.
 */
export const DeletedEnvironments = ({
  environments,
  allowRestore,
  restoringId,
  onRestore,
  onDeleteNow,
}: {
  environments: DeletedEnvironmentType[]
  /** Whoever may delete an environment may restore it, or delete it now */
  allowRestore: boolean
  restoringId: string | null
  onRestore: (environment: PendingDeletion) => void
  onDeleteNow: (environment: PendingDeletion) => Promise<void>
}) => (
  <PendingDeletionList
    kind="Environment"
    description={`Deleted Environments are kept for ${DELETION_GRACE_PERIOD}, then permanently deleted. Their secrets are unavailable until restored.`}
    items={environments}
    allowRestore={() => allowRestore}
    restoringId={restoringId}
    onRestore={onRestore}
    onDeleteNow={onDeleteNow}
  />
)
