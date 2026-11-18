'use client'

import { useContext } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { Menu } from '@headlessui/react'
import { FaCheck, FaPlus } from 'react-icons/fa'
import { TbSelector } from 'react-icons/tb'
import { organisationContext } from '@/contexts/organisationContext'
import { PlanLabel } from '../settings/organisation/PlanLabel'

const ROW_STYLE = 'flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs transition ease'
const ROW_TEXT = 'text-zinc-600 dark:text-zinc-400'
const ROW_ACTIVE = 'bg-zinc-900/5 text-zinc-900 dark:bg-white/5 dark:text-zinc-100'

// Organisation switcher shown beside the first breadcrumb
export const OrgSwitcher = () => {
  const { organisations, activeOrganisation } = useContext(organisationContext)
  // Orgs pending deletion are locked, so they can't be switched to.
  const switchableOrganisations = organisations?.filter((org) => !org.deletedAt) ?? []
  const isOwner = organisations?.some((org) => org.role!.name!.toLowerCase() === 'owner')

  if (switchableOrganisations.length < 2) return null

  return (
    <Menu>
      <Menu.Button
        title="Switch organisation"
        className="-ml-1 flex size-5 shrink-0 items-center justify-center rounded text-neutral-500 transition ease hover:bg-zinc-900/5 hover:text-zinc-900 data-[open]:bg-zinc-900/10 data-[open]:text-zinc-900 dark:hover:bg-white/5 dark:hover:text-zinc-100 dark:data-[open]:bg-white/10 dark:data-[open]:text-zinc-100"
      >
        <TbSelector className="size-3.5" />
      </Menu.Button>
      {/* Anchored, so it renders in a portal: the breadcrumb trail clips its overflow */}
      <Menu.Items
        anchor={{ to: 'bottom start', gap: 8 }}
        transition
        className="z-20 w-56 origin-top-left divide-y divide-neutral-500/20 rounded-md bg-neutral-200 shadow-2xl ring-1 ring-inset ring-neutral-500/40 transition duration-100 ease-out focus:outline-none data-[closed]:scale-95 data-[closed]:opacity-0 dark:bg-neutral-800"
      >
        <div className="space-y-0.5 p-1">
          {switchableOrganisations.map((org) => {
            const current = org.id === activeOrganisation?.id
            return (
              <Menu.Item key={org.id}>
                {({ active }) => (
                  <Link
                    href={`/${org.name}`}
                    title={current ? org.name : `Switch to ${org.name}`}
                    aria-current={current ? 'true' : undefined}
                    className={clsx(
                      ROW_STYLE,
                      'font-medium',
                      current ? 'text-zinc-900 dark:text-zinc-100' : ROW_TEXT,
                      active && ROW_ACTIVE
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{org.name}</span>
                    <PlanLabel plan={org.plan} size="sm" />
                    <FaCheck
                      className={clsx(
                        'size-2.5 shrink-0 text-emerald-500',
                        !current && 'invisible'
                      )}
                    />
                  </Link>
                )}
              </Menu.Item>
            )
          })}
        </div>
        {!isOwner && (
          <div className="p-1">
            <Menu.Item>
              {({ active }) => (
                <Link href="/onboard" className={clsx(ROW_STYLE, ROW_TEXT, active && ROW_ACTIVE)}>
                  <FaPlus className="size-3.5 shrink-0 text-neutral-500" />
                  Create New Organisation
                </Link>
              )}
            </Menu.Item>
          </div>
        )}
      </Menu.Items>
    </Menu>
  )
}
