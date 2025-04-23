import GenericDialog from '@/components/common/GenericDialog'
import { organisationContext } from '@/contexts/organisationContext'
import { useContext, useRef } from 'react'
import { FaTrash } from 'react-icons/fa'
import { DeleteAccessPolicy } from '@/graphql/mutations/access/deleteNetworkAccessPolicy.gql'
import { GetNetworkPolicies } from '@/graphql/queries/access/getNetworkPolicies.gql'
import { Button } from '@/components/common/Button'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { NetworkAccessPolicyType } from '@/apollo/graphql'

export const DeleteNetworkAccessPolicyDialog = ({
  policy,
}: {
  policy: NetworkAccessPolicyType
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [deletePolicy, { loading }] = useMutation(DeleteAccessPolicy)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const closeModal = () => dialogRef.current?.closeModal()

  const handleDelete = async () => {
    await deletePolicy({
      variables: {
        id: policy.id,
      },
      refetchQueries: [
        { query: GetNetworkPolicies, variables: { organisationId: organisation?.id } },
      ],
    })

    toast.success('Updated network access policy')
    closeModal()
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Delete Network Access Policy"
      buttonVariant="danger"
      buttonContent={
        <>
          <FaTrash /> Delete policy
        </>
      }
    >
      <div className="space-y-6 py-4">
        <p className="text-neutral-500">
          Are you sure you want to delete the{' '}
          <span className="text-zinc-900 dark:text-zinc-100 font-medium">{policy.name}</span>{' '}
          Network Access Policy?
        </p>
        <div className="flex items-center gap-4">
          <Button variant="secondary" type="button" onClick={closeModal}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} isLoading={loading}>
            <FaTrash /> Delete policy
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
