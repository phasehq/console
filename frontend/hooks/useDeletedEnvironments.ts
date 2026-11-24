import { useMutation, useQuery } from '@apollo/client'
import { useState } from 'react'
import { toast } from 'react-toastify'
import { DeletedEnvironmentType } from '@/apollo/graphql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetDeletedEnvironments } from '@/graphql/queries/secrets/getDeletedEnvironments.gql'
import { RestoreEnvironmentOp } from '@/graphql/mutations/environments/restoreEnvironment.gql'
import { DeleteEnvironmentNowOp } from '@/graphql/mutations/environments/deleteEnvironmentNow.gql'
import { PendingDeletion } from '@/components/common/PendingDeletionList'
import { usePendingDeletionRefresh } from '@/hooks/usePendingDeletionRefresh'

// One list for every render without any, so what is built from it can be memoized
const NONE: DeletedEnvironmentType[] = []

/**
 * The app's environments that are scheduled for deletion, kept current while the page
 * stays open, and the two things to do with one: restore it, or delete it now.
 */
export const useDeletedEnvironments = (appId: string, enabled = true) => {
  const { data, refetch, startPolling, stopPolling } = useQuery(GetDeletedEnvironments, {
    variables: { appId },
    fetchPolicy: 'cache-and-network',
    skip: !enabled,
  })
  const [restoreEnvironment] = useMutation(RestoreEnvironmentOp)
  const [deleteEnvironmentNow] = useMutation(DeleteEnvironmentNowOp)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const environments = (data?.deletedEnvironments as DeletedEnvironmentType[] | undefined) ?? NONE
  usePendingDeletionRefresh(environments, { refetch, startPolling, stopPolling })

  const restore = async (environment: PendingDeletion) => {
    setRestoringId(environment.id)
    try {
      await restoreEnvironment({
        variables: { environmentId: environment.id },
        refetchQueries: [
          { query: GetAppEnvironments, variables: { appId } },
          // The secrets grid's columns, when it's mounted
          'GetAppSecrets',
        ],
        awaitRefetchQueries: true,
      })
      // Read last: the grid keeps the environment's struck-out column until it has it back
      await refetch()
      toast.success(`${environment.name} has been restored`)
    } catch {
      // the global error link shows the error toast
    } finally {
      setRestoringId(null)
    }
  }

  const deleteNow = async (environment: PendingDeletion) => {
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

  return { environments, restoringId, restore, deleteNow }
}
