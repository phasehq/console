'use client'

import { OrganisationMemberType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import RemoveMember from '@/graphql/mutations/organisation/deleteOrgMember.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { useMutation } from '@apollo/client'
import { useContext, useRef } from 'react'
import { FaTrashAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { useRouter } from 'next/navigation'
import GenericDialog from '@/components/common/GenericDialog'

export const DeleteMemberConfirmDialog = (props: {
  member: OrganisationMemberType
  organisationId: string
}) => {
  const { member, organisationId } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [removeMember] = useMutation(RemoveMember)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const router = useRouter()

  const closeModal = () => dialogRef.current?.closeModal()

  const handleRemoveMember = async () => {
    await removeMember({
      variables: { memberId: member.id },
      refetchQueries: [
        {
          query: GetOrganisationMembers,
          variables: { organisationId: organisationId, role: null },
        },
      ],
      onCompleted: () => {
        toast.success('Member removed successfully')
        closeModal()
        router.push(`/${organisation?.name}/access/members`)
      },
      onError: (error) => {
        toast.error(`Failed to remove member: ${error.message}`)
      },
    })
  }

  const activeUserCanDeleteUsers = organisation?.role?.permissions
    ? userHasPermission(organisation?.role?.permissions, 'Members', 'delete', false)
    : false

  const allowDelete =
    !member.self! && activeUserCanDeleteUsers && member.role!.name!.toLowerCase() !== 'owner'

  if (!allowDelete) return <></>

  return (
    <>
      <GenericDialog
        ref={dialogRef}
        title="Remove member"
        buttonContent={
          <>
            <FaTrashAlt /> Delete
          </>
        }
        buttonVariant="danger"
      >
        <div className="space-y-6 p-4">
          <p className="text-neutral-500">
            Are you sure you want to remove {member.fullName || member.email} from this
            organisation? This action cannot be undone.
          </p>
          <div className="flex items-center gap-4">
            <Button variant="secondary" type="button" onClick={closeModal}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleRemoveMember}>
              Remove Member
            </Button>
          </div>
        </div>
      </GenericDialog>
    </>
  )
}
