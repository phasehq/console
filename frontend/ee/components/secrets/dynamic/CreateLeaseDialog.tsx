import { DynamicSecretLeaseType, DynamicSecretType, KeyMap } from '@/apollo/graphql'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import CopyButton from '@/components/common/CopyButton'
import GenericDialog from '@/components/common/GenericDialog'
import { Input } from '@/components/common/Input'
import { organisationContext } from '@/contexts/organisationContext'
import { CreateDynamicSecretLease } from '@/graphql/mutations/environments/secrets/dynamic/createLease.gql'
import { GetDynamicSecretLeases } from '@/graphql/queries/secrets/dynamic/getSecretLeases.gql'
import { leaseTtlButtons, MINIMUM_LEASE_TTL } from '@/utils/dynamicSecrets'
import { relativeTimeFromDates } from '@/utils/time'
import { useMutation } from '@apollo/client'
import { useContext, useState } from 'react'
import { FaInfoCircle } from 'react-icons/fa'
import { FaBolt } from 'react-icons/fa6'
import { toast } from 'react-toastify'
import { AWSCredentials } from './AWSCredentials'

export const CreateLeaseDialog = ({ secret }: { secret: DynamicSecretType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [createLease, { loading }] = useMutation(CreateDynamicSecretLease)

  const [ttl, setTtl] = useState(secret.defaultTtlSeconds!.toString())
  const [name, setName] = useState(secret.name)

  const [lease, setLease] = useState<DynamicSecretLeaseType | null>(null)

  const reset = () => {
    setTtl(secret.defaultTtlSeconds!.toString())
    setName(secret.name)
    setLease(null)
  }

  const handleCreateLease = async () => {
    if (parseInt(ttl) > secret.maxTtlSeconds!) {
      toast.error(`The maximum allowed TTL for this secret is ${secret.maxTtlSeconds}`)
      return
    }

    if (parseInt(ttl) <= MINIMUM_LEASE_TTL) {
      toast.error(`TTL must be greater than ${MINIMUM_LEASE_TTL} seconds`)
      return
    }

    try {
      const result = await createLease({
        variables: { secretId: secret.id, ttl: parseInt(ttl), name },
        refetchQueries: [
          {
            query: GetDynamicSecretLeases,
            variables: { secretId: secret.id, orgId: organisation?.id },
          },
        ],
      })

      const lease = result.data?.createDynamicSecretLease?.lease
      if (lease) {
        toast.success('Created new lease!')
        setLease(lease)
      }
    } catch (error) {
      console.error(error)
      toast.error('Failed to create lease')
    }
  }

  const ttlButtons = leaseTtlButtons.filter((button) =>
    secret.maxTtlSeconds ? parseInt(button.seconds) <= secret.maxTtlSeconds : button
  )

  return (
    <GenericDialog
      title="Generate secrets"
      buttonContent={
        <>
          <FaBolt /> Generate
        </>
      }
      onClose={reset}
    >
      <div className="space-y-6">
        <div className="text-neutral-500">
          Generate new values for this dynamic secret. These values will be leased to you for the
          specifed TTL.
        </div>

        {lease?.credentials ? (
          <div className="space-y-4">
            <div className="border-b border-neutral-500/40 pb-2">
              <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {lease.name}
              </div>
              <span className="text-neutral-500 text-sm">Lease ID: </span>
              <CopyButton value={lease.id}>
                <span className="text-xs font-mono">{lease.id}</span>
              </CopyButton>
            </div>
            <Alert variant="warning" size="sm" icon={true}>
              Copy these values. You will not be able to view them once this dialog is closed!
            </Alert>

            <AWSCredentials lease={lease} keyMap={(secret?.keyMap as KeyMap[]) || []} />

            <div>
              <div
                className="flex items-center gap-2 text-neutral-500 text-sm"
                title={lease.expiresAt}
              >
                <FaInfoCircle /> This lease expires{' '}
                {relativeTimeFromDates(new Date(lease.expiresAt))}
              </div>
              <div className="font-mono text-sm text-neutral-500">({lease.expiresAt})</div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Input value={name} setValue={setName} label="Name" required />

            <div className="flex items-end gap-4 justify-between">
              <Input
                value={ttl}
                setValue={setTtl}
                type="number"
                label="TTL (seconds)"
                min={MINIMUM_LEASE_TTL}
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
        <div className="flex justify-end">
          {!lease?.credentials && (
            <Button onClick={handleCreateLease} variant="primary" icon={FaBolt} isLoading={loading}>
              Generate
            </Button>
          )}
        </div>
      </div>
    </GenericDialog>
  )
}
