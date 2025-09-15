import { DynamicSecretType, KeyMap } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { organisationContext } from '@/contexts/organisationContext'
import { DeleteDynamicSecretOP } from '@/graphql/mutations/environments/secrets/dynamic/deleteDynamicSecret.gql'
import { GetDynamicSecrets } from '@/graphql/queries/secrets/dynamic/getDynamicSecrets.gql'
import { useMutation } from '@apollo/client'
import { useContext, useRef } from 'react'
import { FaTrashAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { userHasPermission } from '@/utils/access/permissions'
import { Button } from '@/components/common/Button'

export const DeleteDynamicSecretDialog = ({ secret }: { secret: DynamicSecretType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [deleteSecret, { loading: deleteIsPending }] = useMutation(DeleteDynamicSecretOP)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const closeModal = () => dialogRef.current?.closeModal()

  const keyMap: KeyMap[] = secret.keyMap as KeyMap[]

  const handleDelete = async () => {
    await deleteSecret({
      variables: { secretId: secret.id },
      refetchQueries: [{ query: GetDynamicSecrets, variables: { orgId: organisation?.id } }],
    })
    toast.success('Deleted dynamic secret')
  }

  const activeUserCanDeleteUsers = organisation?.role?.permissions
    ? userHasPermission(organisation?.role?.permissions, 'Members', 'delete', false)
    : false

  if (!activeUserCanDeleteUsers) return <></>

  return (
    <GenericDialog
      title="Delete Dynamic Secret"
      buttonVariant="danger"
      buttonContent={
        <div className="py-1">
          <FaTrashAlt />
        </div>
      }
    >
      <div className="space-y-6">
        <p className="text-neutral-500 py-4">
          Are you sure you want to delete this dynamic secret? This will immediately revoke all
          active leases and delete the following secrets from your environment:
          <ul>
            {keyMap.map((k: KeyMap) => (
              <li
                key={k.keyName}
                className="list-disc list-inside font-mono text-red-400 line-through"
              >
                {k.keyName?.toUpperCase()}
              </li>
            ))}
          </ul>
        </p>
        <div className="flex items-center justify-between gap-4">
          <Button variant="secondary" type="button" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            isLoading={deleteIsPending}
            icon={FaTrashAlt}
          >
            Delete Dynamic Secret
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
