'use client'

import { useMutation, useQuery } from '@apollo/client'
import { useState } from 'react'
import { toast } from 'react-toastify'
import { DeletedEnvironmentType } from '@/apollo/graphql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetDeletedEnvironments } from '@/graphql/queries/secrets/getDeletedEnvironments.gql'
import { RestoreEnvironmentOp } from '@/graphql/mutations/environments/restoreEnvironment.gql'
import { PendingDeletion, PendingDeletionList } from '@/components/common/PendingDeletionList'
import { DELETION_GRACE_PERIOD } from '@/constants'

/** The app's environments that are scheduled for deletion, with restore. */
export const DeletedEnvironments = ({
  appId,
  allowRestore,
}: {
  appId: string
  allowRestore: boolean
}) => {
  const { data } = useQuery(GetDeletedEnvironments, {
    variables: { appId },
    fetchPolicy: 'cache-and-network',
  })
  const [restoreEnvironment] = useMutation(RestoreEnvironmentOp)
  const [restoringId, setRestoringId] = useState<string | null>(null)

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

  return (
    <PendingDeletionList
      description={`Deleted Environments are kept for ${DELETION_GRACE_PERIOD}, then permanently deleted. Their secrets are unavailable until restored.`}
      items={(data?.deletedEnvironments as DeletedEnvironmentType[]) ?? []}
      allowRestore={allowRestore}
      restoringId={restoringId}
      onRestore={handleRestore}
    />
  )
}
