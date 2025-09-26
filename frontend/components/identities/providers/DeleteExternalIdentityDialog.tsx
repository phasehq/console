import { IdentityType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { FaTrashAlt } from 'react-icons/fa'
import DeleteIdentity from '@/graphql/mutations/identities/deleteIdentity.gql'
import GetOrganisationIdentities from '@/graphql/queries/identities/getOrganisationIdentities.gql'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { useMutation } from '@apollo/client'
import { useContext, useRef } from 'react'
import { toast } from 'react-toastify'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'

export const DeleteExternalIdentityDialog = ({ identity }: { identity: IdentityType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const closeModal = () => dialogRef.current?.closeModal()

  const canDeleteIdentities = organisation
    ? userHasPermission(organisation.role!.permissions, 'Identities', 'delete')
    : false

  const [deleteIdentity, { loading: deleting }] = useMutation(DeleteIdentity)

  const handleDelete = async () => {
    if (!canDeleteIdentities) return

    try {
      const { id } = identity
      await deleteIdentity({
        variables: { id },
        refetchQueries: [
          { query: GetOrganisationIdentities, variables: { organisationId: organisation?.id } },
        ],
      })
      toast.success('Identity deleted')
    } catch (e) {
      toast.error('Failed to delete identity')
    }
  }

  if (!canDeleteIdentities) return <></>

  return (
    <GenericDialog
      ref={dialogRef}
      title="Delete External Identity"
      buttonVariant="danger"
      buttonContent={
        <>
          <FaTrashAlt />
          Delete
        </>
      }
    >
      <div className="space-y-6">
        <p className="text-neutral-500 py-4 inline-flex items-center gap-1">
          Are you sure you want to delete the{' '}
          <span>
            <ProviderIcon providerId={identity.provider} />
          </span>{' '}
          <span className="text-zinc-900 dark:text-zinc-100">{identity.name}</span> external
          identity?
        </p>
        <div className="flex items-center justify-between gap-4">
          <Button variant="secondary" type="button" onClick={closeModal}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} isLoading={deleting} icon={FaTrashAlt}>
            Delete External Identity
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
