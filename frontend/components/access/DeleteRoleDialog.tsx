import { FaTrash } from 'react-icons/fa'
import GenericDialog from '../common/GenericDialog'
import { RoleType } from '@/apollo/graphql'
import { Button } from '../common/Button'
import { DeleteRole } from '@/graphql/mutations/access/deleteRole.gql'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { useContext, useRef } from 'react'
import { organisationContext } from '@/contexts/organisationContext'

export const DeleteRoleDialog = ({ role }: { role: RoleType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const [deleteRole] = useMutation(DeleteRole)

  const handleDelete = async () => {
    const deleted = await deleteRole({
      variables: { id: role.id },
      refetchQueries: [{ query: GetRoles, variables: { orgId: organisation!.id } }],
    })
    if (deleted.data.deleteCustomRole.ok) {
      toast.success('Deleted Role!')
      if (dialogRef.current) dialogRef.current.closeModal()
    }
  }

  return (
    <GenericDialog
      title={`Delete ${role.name} role`}
      buttonContent={
        <>
          <FaTrash /> Delete
        </>
      }
      buttonVariant="danger"
      ref={dialogRef}
    >
      <div className="space-y-4">
        <div className="text-neutral-500">Are you sure you want to delete this role?</div>
        <div className="flex justify-end">
          <Button variant="danger" onClick={handleDelete}>
            <FaTrash /> Delete
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
