'use client'

import RemoveMemberFromApp from '@/graphql/mutations/apps/removeAppMember.gql'
import { GetAppServiceAccounts } from '@/graphql/queries/apps/getAppServiceAccounts.gql'
import { useMutation } from '@apollo/client'
import { useRef } from 'react'
import { ServiceAccountType, MemberType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { FaRobot, FaTrash } from 'react-icons/fa'
import { toast } from 'react-toastify'
import GenericDialog from '@/components/common/GenericDialog'

export const RemoveAccountConfirmDialog = ({
  account,
  appId,
}: {
  account: ServiceAccountType
  appId: string
}) => {
  const [removeMember] = useMutation(RemoveMemberFromApp)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const closeModal = () => dialogRef.current?.closeModal()

  const handleRemoveMember = async () => {
    await removeMember({
      variables: { memberId: account.id, memberType: MemberType.Service, appId: appId },
      refetchQueries: [
        {
          query: GetAppServiceAccounts,
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
        title="Remove account from App"
        buttonVariant="danger"
        buttonContent={
          <>
            <FaTrash /> Remove account
          </>
        }
      >
        <div className="space-y-6 py-4">
          <p className="text-neutral-500 inline-flex gap-2">
            Are you sure you want to remove{' '}
            <div className="text-zinc-900 dark:text-zinc-100 flex items-center gap-1">
              <div className="rounded-full flex items-center bg-neutral-500/20 justify-center size-5 p-3">
                <FaRobot className="shrink-0 text-zinc-900 dark:text-zinc-100 grow" />
              </div>{' '}
              {account.name}
            </div>{' '}
            from this App?
          </p>

          <div className="flex items-center justify-between gap-4">
            <Button variant="secondary" type="button" onClick={closeModal}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleRemoveMember}>
              <FaTrash />
              Remove
            </Button>
          </div>
        </div>
      </GenericDialog>
    </>
  )
}
