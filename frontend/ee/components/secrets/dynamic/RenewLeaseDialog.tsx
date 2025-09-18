import {
  ApiDynamicSecretLeaseEventEventTypeChoices,
  DynamicSecretLeaseType,
  DynamicSecretType,
} from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { leaseTtlButtons, MINIMUM_LEASE_TTL } from '@/utils/dynamicSecrets'
import { relativeTimeFromDates, humanReadableDuration } from '@/utils/time'
import { useContext, useRef, useState } from 'react'
import { FiRefreshCw } from 'react-icons/fi'
import { RenewDynamicSecretLeaseOP } from '@/graphql/mutations/environments/secrets/dynamic/renewLease.gql'
import { GetDynamicSecretLeases } from '@/graphql/queries/secrets/dynamic/getSecretLeases.gql'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { organisationContext } from '@/contexts/organisationContext'
import { Input } from '@/components/common/Input'
import ProgressBar from '@/components/common/ProgressBar'

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

  // Calculate renewal statistics
  const renewalCount =
    lease.events?.filter(
      (event) => event?.eventType === ApiDynamicSecretLeaseEventEventTypeChoices.Renewed
    ).length || 0
  const currentTtlSeconds = lease.ttl // This is the total TTL (initial + all renewals)
  const maxTtlSeconds = secret.maxTtlSeconds!
  const remainingRenewalTime = Math.max(0, maxTtlSeconds - currentTtlSeconds)

  const ttlButtons = leaseTtlButtons.filter(
    (button) => parseInt(button.seconds) <= remainingRenewalTime
  )

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const closeModal = () => dialogRef.current?.closeModal()

  const [renewLease, { loading: renewIsPending }] = useMutation(RenewDynamicSecretLeaseOP)

  const reset = () => {
    setTtl(secret.defaultTtlSeconds!.toString())
    setRenewedLease(null)
  }

  const handleRenewLease = async () => {
    if (parseInt(ttl) > remainingRenewalTime) {
      toast.error(`The maximum remaining renewal time is ${remainingRenewalTime} seconds`)
      return
    }

    if (parseInt(ttl) < MINIMUM_LEASE_TTL) {
      toast.error(`TTL must be at least ${MINIMUM_LEASE_TTL} seconds`)
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
      ref={dialogRef}
      onClose={reset}
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
          <div className="py-4 space-y-4">
            <div className="text-zinc-900 dark:text-zinc-100 space-y-2 text-sm">
              <p>
                This lease was created{' '}
                <span title={lease.createdAt}>
                  {relativeTimeFromDates(new Date(lease.createdAt))}
                </span>{' '}
                and expires{' '}
                <span title={lease.expiresAt}>
                  {relativeTimeFromDates(new Date(lease.expiresAt))}
                </span>
                .
              </p>

              {renewalCount > 0 && (
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  This lease has been renewed <strong>{renewalCount}</strong> time
                  {renewalCount !== 1 ? 's' : ''}.
                </p>
              )}

              <div className="rounded-md py-2 text-sm">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-neutral-600 dark:text-neutral-400">
                    Total lease time used:
                  </span>
                  <span className="font-mono" title={`${currentTtlSeconds}s / ${maxTtlSeconds}s`}>
                    {humanReadableDuration(currentTtlSeconds)} /{' '}
                    {humanReadableDuration(maxTtlSeconds)}
                  </span>
                </div>
                <ProgressBar
                  percentage={(currentTtlSeconds / maxTtlSeconds) * 100}
                  color="bg-emerald-500"
                  size="sm"
                />

                <div className="flex justify-between items-center mt-2 text-xs text-neutral-500">
                  <span>
                    Maximum remaining renewal time:{' '}
                    <strong title={`${remainingRenewalTime}s`}>
                      {humanReadableDuration(remainingRenewalTime)}
                    </strong>
                  </span>
                </div>
              </div>
            </div>
            {remainingRenewalTime > 0 ? (
              <div>
                <p className="text-sm text-zinc-900 dark:text-zinc-100">
                  Select a duration to extend this lease for:
                </p>
                <div className="flex items-end gap-4 justify-between">
                  <div className="relative w-full">
                    <span className="absolute left-2 bottom-3 text-zinc-900 dark:text-zinc-100">
                      +
                    </span>
                    <Input
                      value={ttl}
                      setValue={setTtl}
                      type="number"
                      label="TTL (seconds)"
                      min={MINIMUM_LEASE_TTL}
                      max={remainingRenewalTime}
                      required
                      className="pl-6"
                    />
                  </div>

                  <div className="flex items-center gap-2 py-1">
                    {ttlButtons.map((button) => (
                      <Button
                        variant={ttl === button.seconds ? 'secondary' : 'ghost'}
                        key={button.label}
                        onClick={() => setTtl(button.seconds)}
                        disabled={parseInt(button.seconds) > remainingRenewalTime}
                      >
                        +{button.label}
                      </Button>
                    ))}
                    {remainingRenewalTime > 0 && (
                      <Button
                        variant={ttl === remainingRenewalTime.toString() ? 'secondary' : 'ghost'}
                        onClick={() => setTtl(remainingRenewalTime.toString())}
                        title={`Extend to maximum remaining time (${remainingRenewalTime}s)`}
                      >
                        Max
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-zinc-900 dark:text-zinc-100 text-sm">
                This lease cannot be renewed any further.
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end">
          {renewedLease ? (
            <Button variant="secondary" onClick={closeModal}>
              Close
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={FiRefreshCw}
              onClick={handleRenewLease}
              isLoading={renewIsPending}
              disabled={remainingRenewalTime <= 0}
            >
              {' '}
              Renew Lease
            </Button>
          )}
        </div>
      </div>
    </GenericDialog>
  )
}
