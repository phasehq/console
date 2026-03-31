'use client'

import GenericDialog from '@/components/common/GenericDialog'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { RemoveTeamMemberOp } from '@/graphql/mutations/teams/removeTeamMember.gql'
import { useMutation } from '@apollo/client'
import { useContext, useRef } from 'react'
import { FaTimes } from 'react-icons/fa'
import { toast } from 'react-toastify'

export const RemoveTeamMemberDialog = ({
  teamId,
  memberId,
  memberName,
  memberType = 'USER',
}: {
  teamId: string
  memberId: string
  memberName: string
  memberType?: string
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [removeMember, { loading }] = useMutation(RemoveTeamMemberOp)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const handleRemove = async () => {
    try {
      await removeMember({
        variables: {
          teamId,
          memberId,
          memberType,
        },
        refetchQueries: [
          {
            query: GetTeams,
            variables: { organisationId: organisation!.id, teamId },
          },
        ],
      })
      toast.success(`Removed ${memberName} from team`)
      dialogRef.current?.closeModal()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <GenericDialog
      title={`Remove ${memberName}`}
      buttonContent={<><FaTimes /> Remove from team</>}
      buttonVariant="danger"
      ref={dialogRef}
      size="sm"
    >
      <div className="space-y-4 pt-4">
        <p className="text-sm text-neutral-500">
          Remove <strong>{memberName}</strong> from this team? Their team-based environment key
          grants will be revoked.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="danger" onClick={handleRemove} isLoading={loading}>
            Remove
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
