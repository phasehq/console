import GenericDialog from '@/components/common/GenericDialog'
import { Input } from '@/components/common/Input'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { organisationContext } from '@/contexts/organisationContext'
import { useContext, useState, useRef, useEffect } from 'react'
import { FaEdit, FaTimesCircle } from 'react-icons/fa'
import { UpdateAccessPolicy } from '@/graphql/mutations/access/updateNetworkAccessPolicy.gql'
import { GetNetworkPolicies } from '@/graphql/queries/access/getNetworkPolicies.gql'
import clsx from 'clsx'
import { Button } from '@/components/common/Button'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { IPChip } from './IPChip'
import { NetworkAccessPolicyType } from '@/apollo/graphql'
import { isValidCidr } from '@/utils/access/ip'
import { userHasPermission } from '@/utils/access/permissions'

export const UpdateNetworkAccessPolicyDialog = ({
  policy,
}: {
  policy: NetworkAccessPolicyType
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanUpdateNetworkPolicies = organisation
    ? userHasPermission(organisation?.role?.permissions, 'NetworkAccessPolicies', 'update')
    : false

  const [updatePolicy, { loading }] = useMutation(UpdateAccessPolicy)

  const [name, setName] = useState(policy.name)
  const [isGlobal, setIsGlobal] = useState(policy.isGlobal)
  const [ips, setIps] = useState<string[]>([])
  const [ipInputValue, setIpInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<{ closeModal: () => void }>(null)

  useEffect(() => {
    const initialIps = policy.allowedIps
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean)
    setIps(initialIps)
  }, [policy.allowedIps])

  const addIp = (value: string) => {
    const trimmed = value.trim().toLowerCase()
    if (!trimmed) return

    if (ips.includes(trimmed)) {
      setError('IP already added.')
      return
    }

    if (!isValidCidr(trimmed)) {
      setError('Invalid IP or CIDR range.')
      return
    }

    setIps([...ips, trimmed])
    setIpInputValue('')
    setError(null)
  }

  const removeIp = (ip: string) => {
    setIps(ips.filter((i) => i !== ip))
    setError(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault()
      addIp(ipInputValue)
    } else if (e.key === 'Backspace' && !ipInputValue && ips.length > 0) {
      setIps(ips.slice(0, -1))
      setError(null)
    }
  }

  const closeModal = () => dialogRef.current?.closeModal()

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (ips.length === 0) {
      toast.error('Please enter at least 1 IP or CIDR range')
      return
    }

    await updatePolicy({
      variables: {
        id: policy.id,
        name,
        allowedIps: ips.join(','),
        isGlobal,
      },
      refetchQueries: [
        { query: GetNetworkPolicies, variables: { organisationId: organisation?.id } },
      ],
    })

    toast.success('Updated network access policy')
    closeModal()
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Edit Network Access Policy"
      buttonVariant="secondary"
      buttonContent={
        <>
          <FaEdit /> Edit policy
        </>
      }
    >
      <div className="text-neutral-500">Edit the allow-list of IP addresses or CIDR ranges</div>

      <form onSubmit={handleSubmit}>
        <div className="space-y-8 py-4">
          <Input
            value={name}
            setValue={setName}
            label="Name"
            required
            disabled={!userCanUpdateNetworkPolicies}
          />
          <div>
            <label className="block text-sm font-medium text-neutral-500 mb-1">
              Allowed IPs or CIDR Ranges
            </label>
            <div
              className={clsx(
                'flex flex-wrap items-center gap-2 p-1 rounded-md ring-1 bg-zinc-100 dark:bg-zinc-800',
                error
                  ? 'ring-red-500 focus-within:ring-red-500'
                  : 'ring-neutral-500/40 focus-within:ring-emerald-500'
              )}
            >
              {ips.map((ip) => (
                <IPChip key={ip} ip={ip}>
                  <button
                    className="ml-1 text-neutral-500 hover:text-red-500 transition ease"
                    onClick={() => removeIp(ip)}
                    type="button"
                  >
                    <FaTimesCircle />
                  </button>
                </IPChip>
              ))}
              <input
                ref={inputRef}
                value={ipInputValue}
                disabled={!userCanUpdateNetworkPolicies}
                onChange={(e) => {
                  setIpInputValue(e.target.value)
                  if (error) setError(null)
                }}
                onKeyDown={handleKeyDown}
                className={clsx(
                  'custom flex-grow outline-none border-none bg-transparent text-sm min-w-[120px]',
                  'text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400'
                )}
                placeholder="e.g. 192.168.1.0/24"
              />
            </div>
            {error && <p className="text-sm text-red-500 mt-1 ml-1">{error}</p>}
          </div>
          <div className="flex items-center justify-between gap-6">
            <div>
              <div className="text-zinc-900 dark:text-zinc-100 font-medium text-sm">
                Set as Global Policy
              </div>
              <div className="text-neutral-500 text-xs">
                Global Policies are applied to all User and Service accounts across the Organisation
              </div>
            </div>
            <ToggleSwitch
              value={isGlobal}
              onToggle={() => setIsGlobal(!isGlobal)}
              disabled={!userCanUpdateNetworkPolicies}
            />
          </div>
        </div>
        <div className="flex items-center justify-between mt-4">
          <Button type="button" variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={loading}>
            Save
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}
