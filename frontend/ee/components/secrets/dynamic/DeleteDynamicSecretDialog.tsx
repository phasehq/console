import {
  ApiDynamicSecretLeaseStatusChoices,
  DynamicSecretLeaseType,
  DynamicSecretType,
  KeyMap,
} from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { organisationContext } from '@/contexts/organisationContext'
import { DeleteDynamicSecretOP } from '@/graphql/mutations/environments/secrets/dynamic/deleteDynamicSecret.gql'
import { GetDynamicSecrets } from '@/graphql/queries/secrets/dynamic/getDynamicSecrets.gql'
import { GetDynamicSecretLeases } from '@/graphql/queries/secrets/dynamic/getSecretLeases.gql'
import { useLazyQuery, useMutation } from '@apollo/client'
import { useContext, useEffect, useRef, useState } from 'react'
import { FaTrashAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { userHasPermission } from '@/utils/access/permissions'
import { Button } from '@/components/common/Button'
import { Avatar } from '@/components/common/Avatar'
import { relativeTimeFromDates } from '@/utils/time'
import { Alert } from '@/components/common/Alert'
import { Input } from '@/components/common/Input'

const ActiveLeaseCard = ({ lease }: { lease: DynamicSecretLeaseType }) => {
  return (
    <div className="grid grid-cols-2 py-1">
      <div>
        <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{lease.name}</div>
        <div className="font-mono text-2xs text-neutral-500">{lease.id}</div>
      </div>
      <div className="text-xs flex flex-col items-end">
        <div className="text-neutral-500 flex items-center gap-1">
          Created {relativeTimeFromDates(new Date(lease.createdAt))}
          {(lease.organisationMember || lease.serviceAccount) && (
            <div className="flex items-center gap-1">
              <span className="text-neutral-500 w-4">by</span>
              <Avatar
                member={lease.organisationMember || undefined}
                serviceAccount={lease.serviceAccount || undefined}
                size="sm"
              />
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {lease.organisationMember?.self
                  ? 'You'
                  : lease.organisationMember?.fullName || lease.serviceAccount?.name}
              </span>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center">
          <div className="text-neutral-500">
            Expires {relativeTimeFromDates(new Date(lease.expiresAt))}
          </div>
        </div>
      </div>
    </div>
  )
}

export const DeleteDynamicSecretDialog = ({ secret }: { secret: DynamicSecretType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [deleteSecret, { loading: deleteIsPending }] = useMutation(DeleteDynamicSecretOP)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const [isOpen, setIsOpen] = useState(false)
  // Listen for dialog open/close
  const handleOpen = () => setIsOpen(true)
  const handleClose = () => setIsOpen(false)

  const [confirmed, setConfirmed] = useState(false)

  const closeModal = () => dialogRef.current?.closeModal()

  const keyMap: KeyMap[] = secret.keyMap as KeyMap[]

  const [fetchLeases, { data, refetch, loading }] = useLazyQuery(GetDynamicSecretLeases, {
    notifyOnNetworkStatusChange: true,
  })

  // Fetch leases when dialog is opened
  useEffect(() => {
    if (isOpen && organisation) {
      fetchLeases({
        variables: { secretId: secret.id, orgId: organisation?.id },
        fetchPolicy: 'cache-and-network',
      })
    }
  }, [isOpen, organisation, fetchLeases, secret.id])

  const activeLeases: DynamicSecretLeaseType[] =
    data?.dynamicSecrets[0].leases?.filter(
      (lease: DynamicSecretLeaseType) => lease.status === ApiDynamicSecretLeaseStatusChoices.Active
    ) ?? []

  const handleDelete = async () => {
    await deleteSecret({
      variables: { secretId: secret.id },
      refetchQueries: [{ query: GetDynamicSecrets, variables: { orgId: organisation?.id } }],
    })
    toast.success('Deleted dynamic secret')
    closeModal()
  }

  const allowDelete = activeLeases.length === 0 || (activeLeases.length > 0 && confirmed)

  const activeUserCanDeleteUsers = organisation?.role?.permissions
    ? userHasPermission(organisation?.role?.permissions, 'Members', 'delete', false)
    : false

  if (!activeUserCanDeleteUsers) return <></>

  return (
    <GenericDialog
      title="Delete Dynamic Secret"
      buttonVariant="danger"
      buttonContent={
        <div className="p-1">
          <FaTrashAlt />
        </div>
      }
      onOpen={handleOpen}
      onClose={handleClose}
    >
      <div className="space-y-6">
        <p className="text-neutral-500 py-4">
          Are you sure you want to delete this dynamic secret? This will delete the following
          secrets from your environment:
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

        {activeLeases.length > 0 && (
          <div>
            <p className="text-red-400 py-4 text-base">
              Warning: This dynamic secret has{' '}
              <span className="font-semibold">{activeLeases.length}</span> active lease
              {`${activeLeases.length !== 1 ? 's' : ''}`} which will immediately be revoked:
              <div className="divide-y divide-neutral-400/10 pt-2">
                {activeLeases.slice(0, 5).map((lease) => (
                  <ActiveLeaseCard key={lease.id} lease={lease} />
                ))}
              </div>
              {activeLeases.length > 5 && (
                <div className="text-center text-sm text-zinc-900 dark:text-zinc-100">
                  + {activeLeases.length - 5} more
                </div>
              )}
            </p>
            <div className="flex items-center justify-end gap-2 text-red-400">
              <input
                type="checkbox"
                className="cursor-pointer"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <div className=" text-sm">Revoke all active leases.</div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <Button variant="secondary" type="button" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!allowDelete}
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
