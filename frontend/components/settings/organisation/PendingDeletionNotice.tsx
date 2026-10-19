'use client'

import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { FaClock, FaUndo } from 'react-icons/fa'
import { OrganisationType } from '@/apollo/graphql'
import { RestoreOrganisationOp } from '@/graphql/mutations/organisation/restoreOrganisation.gql'
import { Button } from '@/components/common/Button'
import { formatDeletionDate } from '@/utils/organisation'

/** Lobby card actions for an organisation that is scheduled for deletion. */
export const PendingDeletionNotice = ({ organisation }: { organisation: OrganisationType }) => {
  const [restoreOrganisation, { loading }] = useMutation(RestoreOrganisationOp)

  const isOwner = organisation.role?.name?.toLowerCase() === 'owner'

  const handleRestore = async (event: React.MouseEvent) => {
    event.stopPropagation()
    try {
      await restoreOrganisation({ variables: { organisationId: organisation.id } })
      toast.success(`${organisation.name} has been restored`)
    } catch {
      // the global error link shows the error toast
    }
  }

  return (
    <div className="flex flex-col gap-2 items-end text-right">
      <div className="flex items-center gap-1.5 text-red-500 text-xs">
        <FaClock className="shrink-0" />
        <span>
          Scheduled for deletion on {formatDeletionDate(organisation.deletionScheduledFor)}
        </span>
      </div>
      {isOwner ? (
        <Button variant="secondary" icon={FaUndo} isLoading={loading} onClick={handleRestore}>
          Restore organisation
        </Button>
      ) : (
        <span className="text-2xs text-neutral-500">
          Only the organisation owner can restore it.
        </span>
      )}
    </div>
  )
}
