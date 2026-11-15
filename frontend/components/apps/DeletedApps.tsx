'use client'

import { useMutation, useQuery } from '@apollo/client'
import { useState } from 'react'
import { toast } from 'react-toastify'
import { DeletedAppType } from '@/apollo/graphql'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { GetDeletedApps } from '@/graphql/queries/apps/getDeletedApps.gql'
import { RestoreAppOp } from '@/graphql/mutations/apps/restoreApp.gql'
import { PendingDeletion, PendingDeletionList } from '@/components/common/PendingDeletionList'
import { DELETION_GRACE_PERIOD } from '@/constants'

/** The organisation's apps that are scheduled for deletion, with restore. */
export const DeletedApps = ({
  organisationId,
  allowRestore,
}: {
  organisationId: string
  allowRestore: boolean
}) => {
  const { data } = useQuery(GetDeletedApps, {
    variables: { organisationId },
    fetchPolicy: 'cache-and-network',
  })
  const [restoreApp] = useMutation(RestoreAppOp)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const handleRestore = async (app: PendingDeletion) => {
    setRestoringId(app.id)
    try {
      await restoreApp({
        variables: { id: app.id },
        refetchQueries: [
          { query: GetApps, variables: { organisationId } },
          { query: GetDeletedApps, variables: { organisationId } },
        ],
        awaitRefetchQueries: true,
      })
      toast.success(`${app.name} has been restored`)
    } catch {
      // the global error link shows the error toast
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <PendingDeletionList
      description={`Deleted Apps are kept for ${DELETION_GRACE_PERIOD}, then permanently deleted. Their secrets are unavailable until restored.`}
      items={(data?.deletedApps as DeletedAppType[]) ?? []}
      allowRestore={allowRestore}
      restoringId={restoringId}
      onRestore={handleRestore}
    />
  )
}
