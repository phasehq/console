'use client'

import { OrganisationMemberInviteType, OrganisationMemberType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import GetInvites from '@/graphql/queries/organisation/getInvites.gql'
import DeleteOrgInvite from '@/graphql/mutations/organisation/deleteInvite.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { useMutation } from '@apollo/client'
import { useContext, useRef } from 'react'
import { FaTrashAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { useRouter } from 'next/navigation'
import GenericDialog from '@/components/common/GenericDialog'

export const DeleteInviteDialog = ({ invite }: { invite: OrganisationMemberInviteType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [deleteInvite, { loading: deletePending }] = useMutation(DeleteOrgInvite)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const router = useRouter()

  const closeModal = () => dialogRef.current?.closeModal()

  const handleDeleteInvite = async () => {
    await deleteInvite({
      variables: {
        inviteId: invite.id,
      },
      refetchQueries: [
        {
          query: GetInvites,
          variables: {
            orgId: organisation?.id,
          },
        },
      ],
    })
    toast.success('Deleted invite successfully')
  }

  const activeUserCanDeleteUsers = organisation?.role?.permissions
    ? userHasPermission(organisation?.role?.permissions, 'Members', 'delete', false)
    : false

  if (!activeUserCanDeleteUsers) return <></>

  return (
    <>
      <GenericDialog
        ref={dialogRef}
        title="Delete Invite"
        buttonContent={
          <>
            <FaTrashAlt /> Delete
          </>
        }
        buttonVariant="danger"
      >
        <div className="space-y-6 p-4">
          <p className="text-neutral-500">
            Are you sure you want to delete the invite for{' '}
            <span className="text-zinc-900 dark:text-zinc-100">{invite.inviteeEmail}</span>?
          </p>
          <div className="flex items-center justify-between gap-4">
            <Button variant="secondary" type="button" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDeleteInvite}
              isLoading={deletePending}
              icon={FaTrashAlt}
            >
              Delete Invite
            </Button>
          </div>
        </div>
      </GenericDialog>
    </>
  )
}
