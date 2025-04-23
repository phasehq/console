import GenericDialog from '@/components/common/GenericDialog'
import { Input } from '@/components/common/Input'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { organisationContext } from '@/contexts/organisationContext'
import { useContext, useState, useRef } from 'react'
import { FaPlus, FaTimesCircle } from 'react-icons/fa'
import { CreateAccessPolicy } from '@/graphql/mutations/access/createNetworkAccessPolicy.gql'
import { GetNetworkPolicies } from '@/graphql/queries/access/getNetworkPolicies.gql'
import clsx from 'clsx'
import { Button } from '@/components/common/Button'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { IPChip } from './IPChip'
import { isValidCidr } from '@/utils/access/ip'

export const CreateNetworkAccessPolicyDialog = () => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [createPolicy, { loading }] = useMutation(CreateAccessPolicy)

  const [name, setName] = useState('')
  const [isGlobal, setIsGlobal] = useState(false)
  const [ips, setIps] = useState<string[]>([])
  const [ipInputValue, setIpInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<{ closeModal: () => void }>(null)

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
      toast.error('Please enter atleast 1 IP or CIDR range')
      return
    }

    await createPolicy({
      variables: {
        name,
        allowedIps: ips.join(','),
        isGlobal,
        organisationId: organisation?.id,
      },
      refetchQueries: [
        { query: GetNetworkPolicies, variables: { organisationId: organisation?.id } },
      ],
    })

    toast.success('Created new  network access policy')
    closeModal()
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Create Network Access Policy"
      buttonContent={
        <>
          <FaPlus /> Create policy
        </>
      }
    >
      <div className="text-neutral-500">Add an allow-list of IP addresses or CIDR ranges</div>

      <form onSubmit={handleSubmit}>
        <div className="space-y-8 py-4" onSubmit={handleSubmit}>
          <Input value={name} setValue={setName} label="Name" required />
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
            <ToggleSwitch value={isGlobal} onToggle={() => setIsGlobal(!isGlobal)} />
          </div>
        </div>
        <div className="flex items-center justify-between mt-4">
          <Button type="button" variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={loading}>
            Create
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}
