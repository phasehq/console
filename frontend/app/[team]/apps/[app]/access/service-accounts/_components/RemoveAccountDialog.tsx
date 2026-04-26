'use client'

import RemoveMemberFromApp from '@/graphql/mutations/apps/removeAppMember.gql'
import { GetAppServiceAccounts } from '@/graphql/queries/apps/getAppServiceAccounts.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { useMutation } from '@apollo/client'
import { useRef } from 'react'
import { ServiceAccountType, MemberType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { FaRobot, FaTrash } from 'react-icons/fa'
import { toast } from 'react-toastify'
import GenericDialog from '@/components/common/GenericDialog'
import { Avatar } from '@/components/common/Avatar'
import { Alert } from '@/components/common/Alert'

export const RemoveAccountConfirmDialog = ({
  account,
  appId,
  teams,
}: {
  account: ServiceAccountType
  appId: string
  teams?: { id: string; name: string }[]
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
        {
          query: GetAppEnvironments,
          variables: { appId: appId, memberId: account.id, memberType: MemberType.Service },
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
        <div className="space-y-6 pt-4">
          <p className="text-neutral-500 text-sm inline-flex gap-2">
            Are you sure you want to remove{' '}
            <div className="text-zinc-900 dark:text-zinc-100 flex items-center gap-1">
              <Avatar serviceAccount={account} size="sm" />
              {account.name}
            </div>{' '}
            from this App?
          </p>
          {teams && teams.length > 0 && (
            <Alert variant="info" icon={true} size="sm">
              <p>
                This account will retain access to this app via the{' '}
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
              <FaTrash />
              Remove
            </Button>
          </div>
        </div>
      </GenericDialog>
    </>
  )
}
