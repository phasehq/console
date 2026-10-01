'use client'

import { Fragment, type ReactNode } from 'react'
import { Listbox, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { FaCheck, FaChevronDown } from 'react-icons/fa'

export type AgentSelectOption = {
  value: string
  label: ReactNode
  disabled?: boolean
  icon?: ReactNode
  separatorBefore?: boolean
}

export function AgentSelect({
  value,
  onChange,
  options,
  id,
  disabled = false,
  required = false,
  placeholder = 'Select an option',
  size = 'sm',
}: {
  value: string
  onChange: (value: string) => void
  options: AgentSelectOption[]
  id?: string
  disabled?: boolean
  required?: boolean
  placeholder?: string
  size?: 'xs' | 'sm'
}) {
  const selectedOption = options.find((option) => option.value === value)

  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      {({ open }) => (
        <div className="relative w-full">
          <Listbox.Button
            id={id}
            aria-required={required}
            className={clsx(
              'flex w-full items-center justify-between gap-3 rounded-md bg-zinc-100 px-3 py-2 text-left text-zinc-800 ring-1 ring-inset ring-neutral-500/40 transition focus:outline-none focus:ring-1 focus:ring-inset focus:ring-emerald-500 dark:bg-zinc-800 dark:text-zinc-100',
              size === 'xs' ? 'text-xs' : 'text-sm',
              disabled
                ? 'cursor-not-allowed opacity-60'
                : 'cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700'
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              {selectedOption?.icon && <span className="shrink-0">{selectedOption.icon}</span>}
              <span
                className={clsx(
                  'truncate',
                  !selectedOption && 'text-neutral-500',
                  selectedOption?.disabled && 'text-neutral-500'
                )}
              >
                {selectedOption?.label || placeholder}
              </span>
            </span>
            <FaChevronDown
              aria-hidden="true"
              className={clsx(
                'shrink-0 text-2xs text-neutral-500 transition-transform duration-200',
                open && 'rotate-180'
              )}
            />
          </Listbox.Button>

          <Transition
            as={Fragment}
            enter="transition duration-100 ease-out"
            enterFrom="transform scale-95 opacity-0"
            enterTo="transform scale-100 opacity-100"
            leave="transition duration-75 ease-out"
            leaveFrom="transform scale-100 opacity-100"
            leaveTo="transform scale-95 opacity-0"
          >
            <Listbox.Options
              className={clsx(
                'absolute z-30 mt-1 max-h-60 w-full origin-top overflow-y-auto rounded-md bg-zinc-200 p-1.5 text-zinc-800 shadow-xl ring-1 ring-inset ring-neutral-500/20 focus:outline-none dark:bg-zinc-800 dark:text-zinc-100',
                size === 'xs' ? 'text-xs' : 'text-sm'
              )}
            >
              {options.map((option) => (
                <Listbox.Option
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={({ active, selected, disabled: optionDisabled }) =>
                    clsx(
                      'flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left outline-none',
                      option.separatorBefore && 'mt-1.5 border-t border-neutral-500/30 pt-3',
                      optionDisabled
                        ? 'cursor-not-allowed text-neutral-500 opacity-60'
                        : 'cursor-pointer',
                      active && !optionDisabled && 'bg-zinc-100 dark:bg-zinc-700',
                      selected && 'font-semibold text-zinc-900 dark:text-zinc-100'
                    )
                  }
                >
                  {({ selected }) => (
                    <>
                      <span className="flex min-w-0 items-center gap-2">
                        {option.icon && <span className="shrink-0">{option.icon}</span>}
                        <span className="truncate">{option.label}</span>
                      </span>
                      <span className="flex size-3.5 shrink-0 items-center justify-center">
                        {selected && <FaCheck aria-hidden="true" className="text-emerald-500" />}
                      </span>
                    </>
                  )}
                </Listbox.Option>
              ))}
            </Listbox.Options>
          </Transition>
        </div>
      )}
    </Listbox>
  )
}
