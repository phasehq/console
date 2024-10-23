import { FaTrash } from 'react-icons/fa'
import { DeleteServiceAccountToken } from '@/graphql/mutations/service-accounts/deleteServiceAccountToken.gql'
import { GetServiceAccounts } from '@/graphql/queries/service-accounts/getServiceAccounts.gql'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { useContext, useRef } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import { ServiceAccountTokenType, ServiceAccountType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { useRouter } from 'next/navigation'

export const DeleteServiceAccountTokenDialog = ({ token }: { token: ServiceAccountTokenType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const [deleteToken] = useMutation(DeleteServiceAccountToken)

  const handleDelete = async () => {
    const deleted = await deleteToken({
      variables: { id: token.id },
      refetchQueries: [{ query: GetServiceAccounts, variables: { orgId: organisation!.id } }],
    })
    if (deleted.data.deleteServiceAccountToken.ok) {
      toast.success('Deleted token!')
      if (dialogRef.current) dialogRef.current.closeModal()
    }
  }

  return (
    <GenericDialog
      title={`Delete ${token.name}`}
      buttonContent={
        <>
          <FaTrash /> Delete
        </>
      }
      buttonVariant="danger"
      ref={dialogRef}
    >
      <div className="space-y-4">
        <div className="text-neutral-500 py-4">Are you sure you want to delete this token?</div>
        <div className="flex justify-end">
          <Button variant="danger" onClick={handleDelete}>
            <FaTrash /> Delete
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
