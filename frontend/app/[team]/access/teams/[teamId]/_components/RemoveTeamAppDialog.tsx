'use client'

import GenericDialog from '@/components/common/GenericDialog'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { RemoveTeamAppOp } from '@/graphql/mutations/teams/removeTeamApp.gql'
import { useMutation } from '@apollo/client'
import { useContext, useRef } from 'react'
import { FaTrashAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'

export const RemoveTeamAppDialog = ({
  teamId,
  teamName,
  appId,
  appName,
}: {
  teamId: string
  teamName: string
  appId: string
  appName: string
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const [removeApp, { loading }] = useMutation(RemoveTeamAppOp)
  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const handleRemove = async () => {
    try {
      await removeApp({
        variables: { teamId, appId },
        refetchQueries: [
          {
            query: GetTeams,
            variables: { organisationId: organisation!.id },
          },
        ],
      })
      toast.success(`Removed ${appName} from ${teamName}`)
      dialogRef.current?.closeModal()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <GenericDialog
      title={`Remove ${appName}?`}
      buttonContent={
        <div className="py-1">
          <FaTrashAlt />
        </div>
      }
      buttonVariant="danger"
      ref={dialogRef}
    >
      <div className="space-y-4 pt-4">
        <p className="text-sm text-neutral-500">
          This will remove <strong className="text-zinc-900 dark:text-zinc-100">{appName}</strong>{' '}
          from team <strong className="text-zinc-900 dark:text-zinc-100">{teamName}</strong>. Team
          members will lose access to environments granted through this team unless they have
          individual access, or access through any other teams.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="danger" onClick={handleRemove} isLoading={loading}>
            Remove App
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
