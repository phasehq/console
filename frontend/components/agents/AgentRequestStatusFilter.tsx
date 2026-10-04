'use client'

import { Fragment } from 'react'
import { Menu, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { FaCheckCircle, FaCircle, FaFilter } from 'react-icons/fa'
import { Button } from '@/components/common/Button'

const REQUEST_STATUS_OPTIONS = [
  { value: '', label: 'All statuses', color: 'text-neutral-500' },
  { value: 'pending', label: 'Pending', color: 'text-amber-500' },
  { value: 'approved', label: 'Approved', color: 'text-emerald-500' },
  { value: 'denied', label: 'Denied', color: 'text-red-500' },
  { value: 'expired', label: 'Expired', color: 'text-neutral-500' },
]

export function AgentRequestStatusFilter({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const active = value !== ''

  return (
    <Menu as="div" className="relative inline-block text-left">
      <Menu.Button as={Fragment}>
        <Button type="button" variant="secondary" title="Filter Agent requests by status">
          <FaFilter /> Filter
          {active && <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />}
        </Button>
      </Menu.Button>
      <Transition
        as={Fragment}
        enter="transition duration-100 ease-out"
        enterFrom="transform scale-95 opacity-0"
        enterTo="transform scale-100 opacity-100"
        leave="transition duration-75 ease-out"
        leaveFrom="transform scale-100 opacity-100"
        leaveTo="transform scale-95 opacity-0"
      >
        <Menu.Items className="absolute right-0 z-30 mt-2 w-52 origin-top-right rounded-md bg-zinc-200 p-1.5 text-xs text-zinc-800 shadow-xl ring-1 ring-inset ring-neutral-500/20 focus:outline-none dark:bg-zinc-800 dark:text-zinc-100">
          <div className="px-2 pb-1 pt-0.5 text-3xs font-semibold uppercase tracking-widest text-neutral-500">
            Status
          </div>
          {REQUEST_STATUS_OPTIONS.map((option) => (
            <Menu.Item key={option.value}>
              {({ active: optionActive }) => {
                const selected = value === option.value
                return (
                  <button
                    type="button"
                    onClick={() => onChange(option.value)}
                    className={clsx(
                      'flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left',
                      optionActive && 'bg-zinc-100 dark:bg-zinc-700',
                      selected
                        ? 'font-semibold text-zinc-900 dark:text-zinc-100'
                        : 'text-neutral-600 dark:text-neutral-400'
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className={clsx('text-2xs', option.color)}>
                        {selected ? <FaCheckCircle /> : <FaCircle />}
                      </span>
                      {option.label}
                    </span>
                  </button>
                )
              }}
            </Menu.Item>
          ))}
        </Menu.Items>
      </Transition>
    </Menu>
  )
}
