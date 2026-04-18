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
      buttonContent={
        <div className="py-1">
          <FaTrashAlt />
        </div>
      }
      buttonVariant="danger"
      ref={dialogRef}
      onClose={() => setConfirmName('')}
    >
      <div className="space-y-4 pt-4">
        <div className="text-sm text-neutral-500 space-y-2">
          <p>
            Deleting <strong>{teamName}</strong> will:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Revoke all team-based environment access grants</li>
            <li>Delete all team-owned service accounts and revoke their tokens</li>
            <li>Remove all team memberships</li>
          </ul>
          <p>This action cannot be undone.</p>
        </div>
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
