import RemoveMemberFromApp from '@/graphql/mutations/apps/removeAppMember.gql'
import GetAppMembers from '@/graphql/queries/apps/getAppMembers.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { useMutation } from '@apollo/client'
import { Fragment, useRef, useState } from 'react'
import { OrganisationMemberType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { Dialog, Transition } from '@headlessui/react'
import { FaTimes, FaUserTimes } from 'react-icons/fa'
import { toast } from 'react-toastify'
import GenericDialog from '@/components/common/GenericDialog'
import { Avatar } from '@/components/common/Avatar'
import { userHasGlobalAccess } from '@/utils/access/permissions'
import { Alert } from '@/components/common/Alert'

export const RemoveMemberConfirmDialog = ({
  appId,
  member,
  teams,
}: {
  appId: string
  member: OrganisationMemberType
  teams?: { id: string; name: string }[]
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
        {
          query: GetAppEnvironments,
          variables: { appId: appId, memberId: member.id },
        },
      ],
    })
    toast.success('Removed member from app', { autoClose: 2000 })
  }

  if (userHasGlobalAccess(member.role!.permissions)) {
    return <></>
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
        <div className="space-y-6 pt-5">
          <p className="text-neutral-500 text-sm inline-flex gap-2">
            Are you sure you want to remove{' '}
            <div className="text-zinc-900 dark:text-zinc-100 flex items-center">
              <Avatar member={member} size="sm" /> {member.fullName || member.email}
            </div>{' '}
            from this App?
          </p>
          {teams && teams.length > 0 && (
            <Alert variant="info" icon={true} size="sm">
              <p>
                This user will retain access to this app via the{' '}
                {teams.map((t) => (
                  <strong key={t.id}>{t.name}</strong>
                )).reduce<React.ReactNode[]>((acc, el, i) => {
                  if (i === 0) return [el]
                  if (i === teams.length - 1) return [...acc, ' and ', el]
                  return [...acc, ', ', el]
                }, [])}{' '}
                {teams.length === 1 ? 'team' : 'teams'}.
              </p>
            </Alert>
          )}
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
