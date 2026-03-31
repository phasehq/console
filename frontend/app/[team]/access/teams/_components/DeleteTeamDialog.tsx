'use client'

import GenericDialog from '@/components/common/GenericDialog'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { DeleteTeamOp } from '@/graphql/mutations/teams/deleteTeam.gql'
import { useMutation } from '@apollo/client'
import { useContext, useRef, useState } from 'react'
import { FaTrashAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'

export const DeleteTeamDialog = ({
  teamId,
  teamName,
  onDelete,
}: {
  teamId: string
  teamName: string
  onDelete?: () => void
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [deleteTeam, { loading }] = useMutation(DeleteTeamOp)

  const dialogRef = useRef<{ closeModal: () => void }>(null)
  const [confirmName, setConfirmName] = useState('')

  const handleDelete = async () => {
    try {
      await deleteTeam({
        variables: { teamId },
        refetchQueries: [
          {
            query: GetTeams,
            variables: { organisationId: organisation!.id },
          },
        ],
      })
      toast.success('Team deleted')
      dialogRef.current?.closeModal()
      onDelete?.()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <GenericDialog
      title={`Delete ${teamName}`}
      buttonContent={<FaTrashAlt />}
      buttonVariant="danger"
      buttonProps={{ classString: 'py-0.5' }}
      ref={dialogRef}
      onClose={() => setConfirmName('')}
    >
      <div className="space-y-4 pt-4">
        <p className="text-sm text-neutral-500">
          This will permanently delete the team <strong>{teamName}</strong> and revoke all
          environment key grants associated with it. This action cannot be undone.
        </p>
        <div className="space-y-2">
          <label className="block text-neutral-500 text-xs">
            Type <strong>{teamName}</strong> to confirm
          </label>
          <input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            className="w-full rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 p-2 text-sm"
            placeholder={teamName}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="danger"
            onClick={handleDelete}
            isLoading={loading}
            disabled={confirmName !== teamName}
          >
            Delete Team
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
