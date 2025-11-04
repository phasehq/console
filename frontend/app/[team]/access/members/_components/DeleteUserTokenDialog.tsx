'use client'

import { UserTokenType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import DeleteUserToken from '@/graphql/mutations/users/deleteUserToken.gql'
import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import { useMutation } from '@apollo/client'
import { useRef } from 'react'
import { FaTrashAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'

export const DeleteUserTokenDialog = (props: { token: UserTokenType; organisationId: string }) => {
  const { token, organisationId } = props

  const [deleteToken, { loading }] = useMutation(DeleteUserToken)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const closeModal = () => dialogRef.current?.closeModal()

  const handleDelete = async () => {
    try {
      await deleteToken({
        variables: { tokenId: token.id },
        refetchQueries: [
          {
            query: GetOrganisationMembers,
            variables: { organisationId: organisationId, role: null },
          },
        ],
      })
      toast.success(`Token "${token.name}" deleted successfully!`)
      closeModal()
    } catch (error: any) {
      toast.error(`Failed to delete token: ${error.message}`)
      console.error(error)
    }
  }

  return (
    <>
      <GenericDialog
        ref={dialogRef}
        title="Delete personl access token"
        buttonVariant="danger"
        buttonContent={
          <>
            <FaTrashAlt /> Delete
          </>
        }
      >
        <div className="py-6">
          <p className="text-sm text-neutral-500">
            Are you sure you want to delete the token{' '}
            <span className="font-medium text-black dark:text-white">{token.name}</span>? This
            action cannot be undone.
          </p>
        </div>

        <div className="flex justify-between gap-2">
          <Button variant="secondary" onClick={closeModal} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} isLoading={loading}>
            {loading ? 'Deleting...' : 'Delete Token'}
          </Button>
        </div>
      </GenericDialog>
    </>
  )
}
