import { FaTrash } from 'react-icons/fa'
import { DeleteServiceAccountOp } from '@/graphql/mutations/service-accounts/deleteServiceAccount.gql'
import { GetServiceAccounts } from '@/graphql/queries/service-accounts/getServiceAccounts.gql'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { useContext, useRef } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import { ServiceAccountType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { useRouter } from 'next/navigation'

export const DeleteServiceAccountDialog = ({ account }: { account: ServiceAccountType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const [deleteAccount] = useMutation(DeleteServiceAccountOp)

  const handleDelete = async () => {
    const deleted = await deleteAccount({
      variables: { id: account.id },
      refetchQueries: [{ query: GetServiceAccounts, variables: { orgId: organisation!.id } }],
    })
    if (deleted.data.deleteServiceAccount.ok) {
      toast.success('Deleted service account!')
      if (dialogRef.current) dialogRef.current.closeModal()
    }
  }

  const router = useRouter()

  const handleRedirect = () => router.push(`/${organisation?.name}/access/service-accounts`)

  return (
    <GenericDialog
      title={`Delete ${account.name}`}
      buttonContent={
        <>
          <FaTrash /> Delete
        </>
      }
      buttonVariant="danger"
      ref={dialogRef}
      onClose={handleRedirect}
    >
      <div className="space-y-4">
        <div className="text-neutral-500 py-4">
          Are you sure you want to delete this service account? This will delete all service tokens
          associated with this account.
        </div>
        <div className="flex justify-end">
          <Button variant="danger" onClick={handleDelete}>
            <FaTrash /> Delete
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
