import { DynamicSecretLeaseType, DynamicSecretType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { leaseTtlButtons } from '@/utils/dynamicSecrets'
import { relativeTimeFromDates } from '@/utils/time'
import { useContext, useState } from 'react'
import { FiRefreshCw } from 'react-icons/fi'
import { RenewDynamicSecretLeaseOP } from '@/graphql/mutations/environments/secrets/dynamic/renewLease.gql'
import { GetDynamicSecretLeases } from '@/graphql/queries/secrets/dynamic/getSecretLeases.gql'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'
import { Input } from '@/components/common/Input'

export const RenewLeaseDialog = ({
  secret,
  lease,
}: {
  secret: DynamicSecretType
  lease: DynamicSecretLeaseType
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [ttl, setTtl] = useState(secret.defaultTtlSeconds!.toString())
  const [renewedLease, setRenewedLease] = useState<DynamicSecretLeaseType | null>(null)

  const ttlButtons = leaseTtlButtons.filter((button) =>
    secret.maxTtlSeconds ? parseInt(button.seconds) <= secret.maxTtlSeconds : button
  )

  const [renewLease, { loading: renewIsPending }] = useMutation(RenewDynamicSecretLeaseOP)

  const handleRenewLease = async () => {
    if (parseInt(ttl) > secret.maxTtlSeconds!) {
      toast.error(`The maximum allowed TTL for this secret is ${secret.maxTtlSeconds}`)
      return
    }
    try {
      const result = await renewLease({
        variables: { leaseId: lease.id, ttl: parseInt(ttl) },
        refetchQueries: [
          {
            query: GetDynamicSecretLeases,
            variables: { secretId: secret.id, orgId: organisation?.id },
          },
        ],
      })

      const renewedLeaseData = result.data?.renewDynamicSecretLease?.lease
      if (renewedLeaseData) {
        toast.success('Renewed lease')
        setRenewedLease(renewedLeaseData)
      }
    } catch (error) {
      console.error(error)
      toast.error('Failed to renew lease')
    }
  }

  return (
    <GenericDialog
      title="Renew lease"
      buttonVariant="secondary"
      buttonContent={
        <>
          <FiRefreshCw /> Renew
        </>
      }
    >
      <div className="space-y-4">
        <div className="text-neutral-500">Renew the lease for these dynamic secrets</div>

        {renewedLease ? (
          <div className="py-4">
            <div className="text-zinc-900 dark:text-zinc-100">
              This lease has been renewed. The leased credentials will expire{' '}
              {relativeTimeFromDates(new Date(lease.expiresAt))}{' '}
              <span className="font-mono">({lease.expiresAt})</span>.
            </div>
          </div>
        ) : (
          <div className="py-4 space-y-2">
            <div className="text-zinc-900 dark:text-zinc-100">
              <p>
                This lease was created {relativeTimeFromDates(new Date(lease.createdAt))} and
                expires {relativeTimeFromDates(new Date(lease.expiresAt))}{' '}
                <span className="font-mono">({lease.expiresAt})</span>.
              </p>

              <p>Select a TTL to renew this lease.</p>
            </div>
            <div className="flex items-end gap-4 justify-between">
              <Input
                value={ttl}
                setValue={setTtl}
                type="number"
                label="TTL (seconds)"
                max={secret.maxTtlSeconds!}
                required
              />

              <div className="flex items-center gap-2 py-1">
                {ttlButtons.map((button) => (
                  <Button
                    variant={ttl === button.seconds ? 'secondary' : 'ghost'}
                    key={button.label}
                    onClick={() => setTtl(button.seconds)}
                  >
                    {button.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end">
          <Button
            variant="primary"
            icon={FiRefreshCw}
            onClick={handleRenewLease}
            isLoading={renewIsPending}
          >
            {' '}
            Renew Lease
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
