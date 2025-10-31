import { Input } from '@/components/common/Input'
import { Button } from '@/components/common/Button'

import { Avatar } from '@/components/common/Avatar'
import { useState, useRef } from 'react'
import clsx from 'clsx'
import { isValidCidr, isValidIp } from '@/utils/access/ip'
import * as ipaddr from 'ipaddr.js'
import { FaTimesCircle, FaInfo } from 'react-icons/fa'
import { useSession } from 'next-auth/react'
import { IPChip } from '@/app/[team]/access/network/_components/IPChip'
import { arraysEqual } from '@/utils/crypto'

type NetworkAccessPolicyFormProps = {
  initialName?: string
  initialIps?: string[]
  clientIp?: string
  onSubmit: (data: { name: string; ips: string[] }) => void
  onCancel: () => void
  loading?: boolean
  submitLabel?: string
  disabled?: boolean
}

export function NetworkAccessPolicyForm({
  initialName = '',
  initialIps = [],
  clientIp,
  onSubmit,
  onCancel,
  loading,
  submitLabel = 'Save',
  disabled = false,
}: NetworkAccessPolicyFormProps) {
  const { data: session } = useSession()

  const [name, setName] = useState(initialName)
  const [ips, setIps] = useState<string[]>(initialIps)
  const [ipInputValue, setIpInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  const saveRequired = name !== initialName || !arraysEqual(ips, initialIps)

  const addIp = (value: string) => {
    const trimmed = value.trim().toLowerCase()
    if (!trimmed) return

    let normalized = trimmed

    try {
      if (trimmed.includes('/')) {
        if (!isValidCidr(trimmed)) {
          setError('Invalid CIDR range.')
          return
        }
        const [addr, prefix] = trimmed.split('/')
        const parsed = ipaddr.parse(addr)
        normalized = `${parsed.toNormalizedString()}/${prefix}`
      } else {
        if (!isValidIp(trimmed)) {
          setError('Invalid IP address.')
          return
        }
        const parsed = ipaddr.parse(trimmed)
        normalized = parsed.toNormalizedString()
      }
    } catch {
      setError('Invalid IP or CIDR.')
      return
    }

    if (ips.includes(normalized)) {
      setError('IP already added.')
      return
    }

    setIps([...ips, normalized])
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

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({ name, ips })
  }

  const kbdStyle =
    'bg-neutral-200 dark:bg-neutral-800 text-zinc-800 dark:text-zinc-200 font-mono font-semibold text-2xs ring-1 ring-inset ring-neutral-400/20 rounded-md py-0.5 px-1'

  return (
    <form onSubmit={handleFormSubmit}>
      <div className="space-y-8 py-4">
        <Input
          value={name}
          setValue={setName}
          label="Name"
          required
          disabled={disabled}
          maxLength={100}
        />
        <div>
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-neutral-500 mb-1">
              Allowed IPs or CIDR Ranges <span className="text-red-500">*</span>
            </label>
            {error && <p className="text-sm text-red-500 mt-1 ml-1">{error}</p>}
          </div>
          <div
            className={clsx(
              'flex flex-wrap items-center gap-2 p-2 rounded-md ring-1 bg-zinc-100 dark:bg-zinc-800 relative group focus-within:ring-emerald-500',
              error ? 'ring-red-500' : 'ring-neutral-500/40'
            )}
          >
            {ips.map((ip) => (
              <IPChip key={ip} ip={ip}>
                <button
                  className="ml-1 text-neutral-500 hover:text-red-500 transition ease"
                  onClick={() => removeIp(ip)}
                  type="button"
                  disabled={disabled}
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
              disabled={disabled}
            />
            {clientIp && !ips.includes(clientIp) && (
              <div className="absolute left-0 -bottom-9 w-full hidden group-focus-within:block bg-zinc-100 dark:bg-zinc-800 shadow-lg rounded-b-lg border border-neutral-300 dark:border-neutral-700 z-10">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => addIp(clientIp)}
                  disabled={disabled}
                >
                  <Avatar size="sm" user={session?.user} />
                  Add current IP:{' '}
                  <span className="font-mono text-sky-800 dark:text-sky-300">{clientIp}</span>
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-neutral-500 py-2 text-right justify-end">
            <FaInfo /> Enter an IP address or CIDR range and hit{' '}
            <kbd className={kbdStyle}>Enter</kbd>, <kbd className={kbdStyle}>Space</kbd> or{' '}
            <kbd className={kbdStyle}>,</kbd>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          isLoading={loading}
          disabled={disabled || !saveRequired}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
