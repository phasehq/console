import RemoveMemberFromApp from '@/graphql/mutations/apps/removeAppMember.gql'
import GetAppMembers from '@/graphql/queries/apps/getAppMembers.gql'
import { useMutation } from '@apollo/client'
import { Fragment, useRef, useState } from 'react'
import { OrganisationMemberType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { Dialog, Transition } from '@headlessui/react'
import { FaTimes, FaUserTimes } from 'react-icons/fa'
import { toast } from 'react-toastify'
import GenericDialog from '@/components/common/GenericDialog'
import { Avatar } from '@/components/common/Avatar'

export const RemoveMemberConfirmDialog = ({
  appId,
  member,
}: {
  appId: string
  member: OrganisationMemberType
}) => {
  const [removeMember] = useMutation(RemoveMemberFromApp)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const closeModal = () => dialogRef.current?.closeModal()

  const handleRemoveMember = async () => {
    await removeMember({
      variables: { memberId: member.id, appId: appId },
      refetchQueries: [
        {
          query: GetAppMembers,
          variables: { appId: appId },
        },
      ],
    })
    toast.success('Removed member from app', { autoClose: 2000 })
  }

  return (
    <>
      <GenericDialog
        ref={dialogRef}
        title="Remove member from App"
        buttonVariant="danger"
        buttonContent={
          <>
            <FaUserTimes /> Remove member
          </>
        }
      >
        <div className="space-y-6 py-4">
          <p className="text-neutral-500 inline-flex gap-2">
            Are you sure you want to remove{' '}
            <div className="text-zinc-900 dark:text-zinc-100 flex items-center">
              <Avatar member={member} size="sm" /> {member.fullName || member.email}
            </div>{' '}
            from this App?
          </p>
          <div className="flex items-center justify-between gap-4">
            <Button variant="secondary" type="button" onClick={closeModal}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleRemoveMember}>
              <FaUserTimes />
              Remove
            </Button>
          </div>
        </div>
      </GenericDialog>
    </>
  )
}
