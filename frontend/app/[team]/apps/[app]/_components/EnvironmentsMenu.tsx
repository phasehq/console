'use client'

import { Fragment } from 'react'
import { Popover, PopoverButton, PopoverPanel, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { FaChevronDown } from 'react-icons/fa'
import { FaCircle } from 'react-icons/fa6'
import { EnvironmentType } from '@/apollo/graphql'
import { Checkbox } from '@/components/common/Checkbox'
import { envColor } from '@/utils/environment'

export const EnvironmentsMenu = ({
  id,
  title,
  environments,
  checkedEnvIds,
  dirtyEnvIds,
  onToggle,
  onSolo,
  onShowAll,
}: {
  id?: string
  title: string
  /** Every env, in column order */
  environments: EnvironmentType[]
  checkedEnvIds: ReadonlySet<string>
  dirtyEnvIds: ReadonlySet<string>
  onToggle: (envId: string) => void
  onSolo: (envId: string) => void
  onShowAll: () => void
}) => {
  const checkedCount = environments.filter((env) => checkedEnvIds.has(env.id)).length
  const allShown = checkedCount === environments.length

  return (
    // The negative margin sits on the heading so the button's max-width still fits its text
    <Popover as="h1" id={id} className="relative -ml-1.5 min-w-0">
      <PopoverButton className="group flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-200 focus:outline-none data-[open]:bg-zinc-200 data-[focus]:ring-1 data-[focus]:ring-emerald-500/70 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:data-[open]:bg-zinc-800">
        <span className="truncate">{title}</span>
        <FaChevronDown className="shrink-0 text-[9px] text-neutral-500 transition-transform group-data-[open]:rotate-180" />
      </PopoverButton>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="opacity-100 scale-100"
        leaveTo="opacity-0 scale-95"
      >
        <PopoverPanel
          anchor={{ to: 'bottom start', gap: 6, padding: 16 }}
          className="z-50 w-64 rounded-lg bg-zinc-100 p-1 font-normal text-zinc-900 shadow-xl ring-1 ring-inset ring-neutral-500/30 focus:outline-none dark:bg-zinc-800 dark:text-zinc-100"
        >
          <div className="flex items-center justify-between px-2 pb-1 pt-1.5">
            <span className="text-3xs font-medium uppercase tracking-wide text-neutral-500">
              Environments
            </span>
            <button
              type="button"
              onClick={onShowAll}
              disabled={allShown}
              className="text-2xs text-emerald-600 hover:underline disabled:cursor-default disabled:text-neutral-500 disabled:no-underline dark:text-emerald-400 dark:disabled:text-neutral-500"
            >
              Show all
            </button>
          </div>
          <ul>
            {environments.map((env) => {
              const checked = checkedEnvIds.has(env.id)
              const isOnlyShown = checked && checkedCount === 1
              const lockReason = isOnlyShown
                ? 'At least one environment stays shown'
                : checked && dirtyEnvIds.has(env.id)
                  ? `Deploy or discard the changes in ${env.name} before hiding it`
                  : undefined
              const toggle = () => {
                if (!lockReason) onToggle(env.id)
              }
              return (
                // The whole row toggles; its checkbox is the keyboard control
                <li
                  key={env.id}
                  title={lockReason ?? `${checked ? 'Hide' : 'Show'} ${env.name}`}
                  onClick={toggle}
                  className={clsx(
                    'group/row flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-700/60',
                    lockReason ? 'cursor-not-allowed' : 'cursor-pointer'
                  )}
                >
                  <Checkbox
                    size="sm"
                    checked={checked}
                    onChange={toggle}
                    disabled={Boolean(lockReason)}
                  />
                  <FaCircle className="shrink-0 text-[7px]" style={{ color: envColor(env) }} />
                  <span className={clsx('min-w-0 flex-1 truncate', !checked && 'text-neutral-500')}>
                    {env.name}
                  </span>
                  {!isOnlyShown && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onSolo(env.id)
                      }}
                      title={`Show only ${env.name}`}
                      className="shrink-0 rounded px-1.5 py-0.5 text-3xs text-neutral-500 opacity-0 transition-opacity hover:bg-zinc-300 hover:text-zinc-900 focus:opacity-100 group-hover/row:opacity-100 dark:hover:bg-zinc-600 dark:hover:text-zinc-100"
                    >
                      Only
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </PopoverPanel>
      </Transition>
    </Popover>
  )
}
