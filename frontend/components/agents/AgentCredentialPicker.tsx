'use client'

import { Fragment } from 'react'
import { Listbox } from '@headlessui/react'
import clsx from 'clsx'
import { FaChevronDown, FaKey, FaPlus } from 'react-icons/fa'
import { Button } from '@/components/common/Button'

export type AgentCredentialChoice = {
  id: string
  name: string
  provider?: { id: string; name?: string | null } | null
}

/**
 * The credentials drop-down of the sync dialogs, for a list the caller already holds.
 * It stays open with no credentials so one can be added.
 */
export function AgentCredentialPicker({
  id,
  value,
  onChange,
  credentials,
  recommendedProviderId,
  loading = false,
  onAdd,
}: {
  id?: string
  value: string
  onChange: (credentialId: string) => void
  credentials: AgentCredentialChoice[]
  recommendedProviderId?: string
  loading?: boolean
  /** Opens the Add integration dialog; absent when the member cannot add one. */
  onAdd?: () => void
}) {
  const selected = credentials.find((credential) => credential.id === value)
  const label = selected
    ? selected.name
    : loading
      ? 'Loading credentials'
      : credentials.length === 0
        ? 'No credentials available'
        : 'Select credentials'

  return (
    <Listbox value={value} onChange={onChange} disabled={loading}>
      {({ open }) => (
        <div className="relative">
          <Listbox.Button
            id={id}
            aria-required
            className={clsx(
              'flex w-full items-center justify-between gap-3 border border-neutral-500/20 bg-zinc-100 px-2 py-1.5 text-left text-sm text-zinc-800 outline-emerald-500 focus:outline dark:bg-zinc-800/60 dark:text-white',
              loading && 'cursor-not-allowed opacity-60',
              open ? 'rounded-t-md' : 'rounded-md'
            )}
          >
            <span className={clsx('truncate', !selected && 'text-neutral-500')}>{label}</span>
            <FaChevronDown
              aria-hidden="true"
              className={clsx(
                'ease shrink-0 text-xs text-neutral-500 transition-transform duration-300',
                open ? 'rotate-180' : 'rotate-0'
              )}
            />
          </Listbox.Button>
          <Listbox.Options className="absolute z-10 w-full space-y-1 rounded-b-md border border-t-0 border-neutral-500/20 bg-zinc-100 p-1.5 shadow-2xl focus:outline-none dark:bg-zinc-800">
            {credentials.map((credential) => (
              <Listbox.Option key={credential.id} value={credential.id} as={Fragment}>
                {({ active }) => (
                  <div
                    className={clsx(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-black dark:text-white',
                      active && 'bg-zinc-200 dark:bg-zinc-700'
                    )}
                  >
                    <FaKey aria-hidden="true" className="shrink-0 text-xs" />
                    <span className="truncate font-medium">{credential.name}</span>
                    <span className="shrink-0 text-xs text-neutral-500">
                      {credential.provider?.name || credential.provider?.id}
                      {recommendedProviderId && credential.provider?.id === recommendedProviderId
                        ? ' · Recommended'
                        : ''}
                    </span>
                  </div>
                )}
              </Listbox.Option>
            ))}
            {onAdd ? (
              <div
                className={clsx(credentials.length > 0 && 'border-t border-neutral-500/40 pt-1.5')}
              >
                <Button type="button" variant="secondary" onClick={onAdd}>
                  <div className="flex items-center gap-2">
                    <FaPlus /> Add integration
                  </div>
                </Button>
              </div>
            ) : (
              credentials.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-neutral-500">
                  Ask someone who can add integrations to connect one.
                </div>
              )
            )}
          </Listbox.Options>
        </div>
      )}
    </Listbox>
  )
}
