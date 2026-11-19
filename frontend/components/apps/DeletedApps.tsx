'use client'

import { useMutation, useQuery } from '@apollo/client'
import { useState } from 'react'
import { toast } from 'react-toastify'
import { DeletedAppType } from '@/apollo/graphql'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { GetDeletedApps } from '@/graphql/queries/apps/getDeletedApps.gql'
import { RestoreAppOp } from '@/graphql/mutations/apps/restoreApp.gql'
import { DeleteAppNowOp } from '@/graphql/mutations/apps/deleteAppNow.gql'
import { PendingDeletion, PendingDeletionList } from '@/components/common/PendingDeletionList'
import { usePendingDeletionRefresh } from '@/hooks/usePendingDeletionRefresh'
import { DELETION_GRACE_PERIOD } from '@/constants'

/** The organisation's apps that are scheduled for deletion. Each can be restored, or deleted now. */
export const DeletedApps = ({ organisationId }: { organisationId: string }) => {
  const { data, refetch, startPolling, stopPolling } = useQuery(GetDeletedApps, {
    variables: { organisationId },
    fetchPolicy: 'cache-and-network',
  })
  const [restoreApp] = useMutation(RestoreAppOp)
  const [deleteAppNow] = useMutation(DeleteAppNowOp)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const apps = (data?.deletedApps as DeletedAppType[]) ?? []
  usePendingDeletionRefresh(apps, { refetch, startPolling, stopPolling })

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

  const handleDeleteNow = async (app: PendingDeletion) => {
    try {
      await deleteAppNow({
        variables: { id: app.id },
        refetchQueries: [{ query: GetDeletedApps, variables: { organisationId } }],
        awaitRefetchQueries: true,
      })
      toast.success(`${app.name} is being deleted`)
    } catch {
      // the global error link shows the error toast
    }
  }

  return (
    <PendingDeletionList
      kind="App"
      description={`Deleted Apps are kept for ${DELETION_GRACE_PERIOD}, then permanently deleted. Their secrets are unavailable until restored.`}
      items={apps}
      // From the server, for each App: a team can give its members a role for its Apps.
      allowRestore={(app) => app.viewerCanDelete}
      restoringId={restoringId}
      onRestore={handleRestore}
      onDeleteNow={handleDeleteNow}
    />
  )
}
