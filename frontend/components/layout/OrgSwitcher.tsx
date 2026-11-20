'use client'

import { Fragment, useContext } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { Menu } from '@headlessui/react'
import { FaCheck, FaPlus } from 'react-icons/fa'
import { organisationContext } from '@/contexts/organisationContext'
import { PlanLabel } from '../settings/organisation/PlanLabel'

const ROW_STYLE = 'flex w-full items-center rounded-md transition ease'
const ROW_SIZE = 'h-8 gap-2 px-2 text-xs'
const TOUCH_ROW_SIZE = 'h-10 gap-2.5 px-2.5 text-sm'
const ROW_TEXT = 'text-zinc-600 dark:text-zinc-400'
const ROW_ACTIVE = 'bg-zinc-900/5 text-zinc-900 dark:bg-white/5 dark:text-zinc-100'
const ROW_HOVER =
  'hover:bg-zinc-900/5 hover:text-zinc-900 dark:hover:bg-white/5 dark:hover:text-zinc-100'

const useOrganisations = () => {
  const { organisations, activeOrganisation } = useContext(organisationContext)

  return {
    activeOrganisation,
    // Orgs pending deletion are locked, so they can't be switched to.
    switchableOrganisations: organisations?.filter((org) => !org.deletedAt) ?? [],
    isOwner: organisations?.some((org) => org.role!.name!.toLowerCase() === 'owner'),
  }
}

// The organisation rows. In a Headless UI Menu they are menu items. With `onNavigate` they are plain
// links, for a popover. `touch` makes them taller, for the phone More menu
export const OrgMenuItems = ({
  heading,
  touch = false,
  onNavigate,
}: {
  heading?: string
  touch?: boolean
  onNavigate?: () => void
}) => {
  const { activeOrganisation, switchableOrganisations, isOwner } = useOrganisations()
  const rowStyle = clsx(ROW_STYLE, touch ? TOUCH_ROW_SIZE : ROW_SIZE, onNavigate && ROW_HOVER)

  const row = (key: string, render: (active: boolean) => React.ReactElement) =>
    onNavigate ? (
      <Fragment key={key}>{render(false)}</Fragment>
    ) : (
      <Menu.Item key={key}>{({ active }) => render(active)}</Menu.Item>
    )

  return (
    <>
      <div className="space-y-0.5 p-1">
        {heading && (
          <div
            className={clsx(
              'py-1 text-2xs font-semibold uppercase tracking-wide text-neutral-500',
              touch ? 'px-2.5' : 'px-2'
            )}
          >
            {heading}
          </div>
        )}
        {switchableOrganisations.map((org) => {
          const current = org.id === activeOrganisation?.id
          return row(org.id, (active) => (
            <Link
              href={`/${org.name}`}
              onClick={onNavigate}
              title={current ? org.name : `Switch to ${org.name}`}
              aria-current={current ? 'true' : undefined}
              className={clsx(
                rowStyle,
                'font-medium',
                current ? 'text-zinc-900 dark:text-zinc-100' : ROW_TEXT,
                active && ROW_ACTIVE
              )}
            >
              <span className="min-w-0 flex-1 truncate">{org.name}</span>
              <PlanLabel plan={org.plan} size="sm" />
              <FaCheck
                className={clsx('size-2.5 shrink-0 text-emerald-500', !current && 'invisible')}
              />
            </Link>
          ))
        })}
      </div>
      {!isOwner && (
        <div className="p-1">
          {row('create', (active) => (
            <Link
              href="/onboard"
              onClick={onNavigate}
              className={clsx(rowStyle, ROW_TEXT, active && ROW_ACTIVE)}
            >
              <FaPlus className="size-3.5 shrink-0 text-neutral-500" />
              Create New Organisation
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
