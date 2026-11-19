'use client'

import { useMutation, useQuery } from '@apollo/client'
import { useState } from 'react'
import { toast } from 'react-toastify'
import { DeletedEnvironmentType } from '@/apollo/graphql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetDeletedEnvironments } from '@/graphql/queries/secrets/getDeletedEnvironments.gql'
import { RestoreEnvironmentOp } from '@/graphql/mutations/environments/restoreEnvironment.gql'
import { DeleteEnvironmentNowOp } from '@/graphql/mutations/environments/deleteEnvironmentNow.gql'
import { PendingDeletion, PendingDeletionList } from '@/components/common/PendingDeletionList'
import { usePendingDeletionRefresh } from '@/hooks/usePendingDeletionRefresh'
import { DELETION_GRACE_PERIOD } from '@/constants'

/** The app's environments that are scheduled for deletion. Each can be restored, or deleted now. */
export const DeletedEnvironments = ({
  appId,
  allowRestore,
}: {
  appId: string
  allowRestore: boolean
}) => {
  const { data, refetch, startPolling, stopPolling } = useQuery(GetDeletedEnvironments, {
    variables: { appId },
    fetchPolicy: 'cache-and-network',
  })
  const [restoreEnvironment] = useMutation(RestoreEnvironmentOp)
  const [deleteEnvironmentNow] = useMutation(DeleteEnvironmentNowOp)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const environments = (data?.deletedEnvironments as DeletedEnvironmentType[]) ?? []
  usePendingDeletionRefresh(environments, { refetch, startPolling, stopPolling })

  const handleRestore = async (environment: PendingDeletion) => {
    setRestoringId(environment.id)
    try {
      await restoreEnvironment({
        variables: { environmentId: environment.id },
        refetchQueries: [
          { query: GetAppEnvironments, variables: { appId } },
          { query: GetDeletedEnvironments, variables: { appId } },
        ],
        awaitRefetchQueries: true,
      })
      toast.success(`${environment.name} has been restored`)
    } catch {
      // the global error link shows the error toast
    } finally {
      setRestoringId(null)
    }
  }

  const handleDeleteNow = async (environment: PendingDeletion) => {
    try {
      await deleteEnvironmentNow({
        variables: { environmentId: environment.id },
        refetchQueries: [{ query: GetDeletedEnvironments, variables: { appId } }],
        awaitRefetchQueries: true,
      })
      toast.success(`${environment.name} is being deleted`)
    } catch {
      // the global error link shows the error toast
    }
  }

  return (
    <PendingDeletionList
      kind="Environment"
      description={`Deleted Environments are kept for ${DELETION_GRACE_PERIOD}, then permanently deleted. Their secrets are unavailable until restored.`}
      items={environments}
      allowRestore={allowRestore}
      restoringId={restoringId}
      onRestore={handleRestore}
      onDeleteNow={handleDeleteNow}
    />
  )
}
