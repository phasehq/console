import { DynamicSecretLeaseType, DynamicSecretType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { relativeTimeFromDates } from '@/utils/time'
import { useContext, useRef } from 'react'
import { RevokeDynamicSecretLeaseOP } from '@/graphql/mutations/environments/secrets/dynamic/revokeLease.gql'
import { GetDynamicSecretLeases } from '@/graphql/queries/secrets/dynamic/getSecretLeases.gql'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'
import { FaBan } from 'react-icons/fa6'

export const RevokeLeaseDialog = ({
  secret,
  lease,
}: {
  secret: DynamicSecretType
  lease: DynamicSecretLeaseType
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const dialogRef = useRef<{ closeModal: () => void; isOpen: boolean }>(null)

  const [revokeLease, { loading: revokeIsPending }] = useMutation(RevokeDynamicSecretLeaseOP)

  const handleRevokeLease = async () => {
    try {
      const result = await revokeLease({
        variables: { leaseId: lease.id },
        refetchQueries: [
          {
            query: GetDynamicSecretLeases,
            variables: { secretId: secret.id, orgId: organisation?.id },
          },
        ],
      })

      const revokedLeaseData = result.data?.revokeDynamicSecretLease?.lease.revokedAt
      if (revokedLeaseData) {
        toast.success('Revoked lease')
        dialogRef.current?.closeModal()
      }
    } catch (error) {
      console.error(error)
      toast.error('Failed to revoke lease. Please try again later')
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Revoke lease"
      buttonVariant="danger"
      buttonContent={
        <>
          <FaBan /> Revoke
        </>
      }
    >
      <div className="space-y-4">
        <div className="text-neutral-500">Revoke the lease for these dynamic secrets</div>

        <div className="py-4 space-y-2">
          <div className="text-zinc-900 dark:text-zinc-100">
            <p>Are you sure you want to revoke this lease?</p>
            <p>
              This lease was created {relativeTimeFromDates(new Date(lease.createdAt))} and expires{' '}
              {relativeTimeFromDates(new Date(lease.expiresAt))}{' '}
              <span className="font-mono">({lease.expiresAt})</span>.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end">
          <Button
            variant="danger"
            icon={FaBan}
            onClick={handleRevokeLease}
            isLoading={revokeIsPending}
          >
            {' '}
            Revoke Lease
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
