'use client'

import { Fragment, type ReactNode } from 'react'
import { Popover, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { FaCheckCircle, FaCircle, FaFilter } from 'react-icons/fa'
import { FaArrowRotateLeft } from 'react-icons/fa6'
import { Button } from '@/components/common/Button'

const filterCategoryTitleStyle =
  'text-[11px] font-semibold text-neutral-500 tracking-widest uppercase'

/**
 * The filter menu used by the Audit and SCIM logs: a Filter button with a dot
 * while filters apply, and a panel of filter sections with a reset action.
 * A Popover rather than a Menu, so text inputs and selects in the panel keep
 * their own keyboard handling.
 */
export function AgentFilterMenu({
  title,
  active,
  onReset,
  children,
}: {
  title: string
  active: boolean
  onReset: () => void
  children: ReactNode
}) {
  return (
    <Popover className="relative inline-block text-left">
      <div className="relative">
        <Popover.Button as={Button} variant="secondary" title={title}>
          <FaFilter /> Filter
          {active && <span className="sr-only"> (active)</span>}
        </Popover.Button>
        {active && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-0 -right-0 h-2 w-2 rounded-full bg-emerald-500"
          />
        )}
      </div>
      <Transition
        as={Fragment}
        enter="transition duration-100 ease-out"
        enterFrom="transform scale-95 opacity-0"
        enterTo="transform scale-100 opacity-100"
        leave="transition duration-75 ease-out"
        leaveFrom="transform scale-100 opacity-100"
        leaveTo="transform scale-95 opacity-0"
      >
        <Popover.Panel className="absolute right-0 mt-2 z-30 w-96 max-w-[calc(100vw-2rem)] p-4 rounded-md shadow-xl bg-neutral-300/50 dark:bg-neutral-900/60 backdrop-blur-lg ring-1 ring-neutral-500/20 space-y-6">
          {children}
          <div className="flex justify-end pt-2">
            <Button variant="outline" disabled={!active} onClick={onReset}>
              <FaArrowRotateLeft /> Reset filter
            </Button>
          </div>
        </Popover.Panel>
      </Transition>
    </Popover>
  )
}

export function AgentFilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="space-y-2">
      <div className={filterCategoryTitleStyle}>{title}</div>
      {children}
    </div>
  )
}

/** A toggle in a filter section, styled like the Audit and SCIM log filters. */
export function AgentFilterOption({
  selected,
  color = 'text-neutral-500',
  onClick,
  children,
}: {
  selected: boolean
  color?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      variant={selected ? 'primary' : 'secondary'}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className={clsx('text-2xs', color)}>{selected ? <FaCheckCircle /> : <FaCircle />}</span>{' '}
      <span className="text-xs">{children}</span>
    </Button>
  )
}
