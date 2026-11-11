'use client'

import { ReactNode, useState } from 'react'
import clsx from 'clsx'
import { FaCheckCircle, FaCircle, FaSearch } from 'react-icons/fa'
import { OrganisationMemberType, RoleType, ServiceAccountType } from '@/apollo/graphql'
import { Avatar } from '@/components/common/Avatar'
import { RoleLabel } from '@/components/users/RoleLabel'

const TAB =
  '-mb-px flex items-center gap-1.5 border-b p-2 text-xs font-medium transition ease focus:outline-none'
const TAB_COUNT =
  'rounded-full bg-zinc-500/20 px-1.5 py-0.5 text-2xs text-zinc-600 dark:text-zinc-300'
// Past this many, a list gets a search field
const SEARCH_FROM = 8

type Row = {
  id: string
  name: string
  detail?: string | null
  role?: RoleType | null
  avatar: ReactNode
}

const AccountRow = ({
  row,
  selected,
  locked,
  onToggle,
}: {
  row: Row
  selected: boolean
  /** Why this account's access isn't a choice here */
  locked?: string
  onToggle: () => void
}) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={selected}
    disabled={Boolean(locked)}
    title={locked}
    onClick={onToggle}
    className={clsx(
      'flex w-full items-center gap-3 px-2 py-1.5 text-left transition ease',
      locked ? 'cursor-not-allowed opacity-70' : 'hover:bg-zinc-500/10'
    )}
  >
    {selected ? (
      <FaCheckCircle className={clsx('shrink-0', locked ? 'text-neutral-500' : 'text-emerald-500')} />
    ) : (
      <FaCircle className="shrink-0 text-neutral-500/60" />
    )}
    {row.avatar}
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {row.name}
      </span>
      {row.detail && <span className="block truncate text-2xs text-neutral-500">{row.detail}</span>}
    </span>
    {row.role && (
      <span className="max-w-28 shrink-0">
        <RoleLabel role={row.role} />
      </span>
    )}
  </button>
)

type EnvAccessPickerProps = {
  members: OrganisationMemberType[]
  serviceAccounts: ServiceAccountType[]
  selectedIds: ReadonlySet<string>
  /** Accounts that get access regardless, each with the reason */
  lockedReasons: ReadonlyMap<string, string>
  onChange: (ids: Set<string>) => void
}

/** Chooses which of an App's members and service accounts can reach an environment */
export const EnvAccessPicker = ({
  members,
  serviceAccounts,
  selectedIds,
  lockedReasons,
  onChange,
}: EnvAccessPickerProps) => {
  const [pickedTab, setTab] = useState<'members' | 'services' | null>(null)
  const [query, setQuery] = useState('')

  const lists = {
    members: members.map<Row>((member) => ({
      id: member.id,
      name: member.fullName || member.email || '',
      detail: member.fullName ? member.email : null,
      role: member.role,
      avatar: <Avatar member={member} size="md" />,
    })),
    services: serviceAccounts.map<Row>((account) => ({
      id: account.id,
      name: account.name,
      role: account.role,
      avatar: <Avatar serviceAccount={account} size="md" />,
    })),
  }
  // Members unless another tab was picked: the two lists can arrive one after the other
  const tab =
    pickedTab && lists[pickedTab].length > 0
      ? pickedTab
      : lists.members.length > 0
        ? 'members'
        : 'services'
  const isOn = (id: string) => lockedReasons.has(id) || selectedIds.has(id)
  const rows = lists[tab]
  const search = query.trim().toLowerCase()
  const shown = search
    ? rows.filter((row) => `${row.name} ${row.detail ?? ''}`.toLowerCase().includes(search))
    : rows
  const open = rows.filter((row) => !lockedReasons.has(row.id))
  const allOn = open.length > 0 && open.every((row) => selectedIds.has(row.id))

  const toggle = (id: string) => {
    const next = new Set(selectedIds)
    if (!next.delete(id)) next.add(id)
    onChange(next)
  }
  const setAll = (on: boolean) => {
    const next = new Set(selectedIds)
    for (const row of open) on ? next.add(row.id) : next.delete(row.id)
    onChange(next)
  }

  const tabs = [
    { id: 'members' as const, label: 'Members', rows: lists.members },
    { id: 'services' as const, label: 'Service Accounts', rows: lists.services },
  ].filter((t) => t.rows.length > 0)

  return (
    <div>
      <div className="flex items-end justify-between gap-4 border-b border-neutral-500/20">
        <div className="flex gap-2" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id)
                setQuery('')
              }}
              className={clsx(
                TAB,
                tab === t.id
                  ? 'border-emerald-500 text-zinc-900 dark:text-zinc-100'
                  : 'border-transparent text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100'
              )}
            >
              {t.label}
              <span className={TAB_COUNT}>
                {t.rows.filter((row) => isOn(row.id)).length}/{t.rows.length}
              </span>
            </button>
          ))}
        </div>
        {open.length > 1 && (
          <button
            type="button"
            onClick={() => setAll(!allOn)}
            className="pb-2 text-2xs font-medium text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            {allOn ? 'Clear all' : 'Select all'}
          </button>
        )}
      </div>

      {rows.length > SEARCH_FROM && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-zinc-100 px-2 ring-1 ring-inset ring-neutral-500/40 dark:bg-zinc-800">
          <FaSearch className="shrink-0 text-xs text-neutral-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'members' ? 'Search Members' : 'Search Service Accounts'}
            className="custom w-full bg-transparent text-sm text-zinc-900 placeholder:text-neutral-500 dark:text-zinc-100"
          />
        </div>
      )}

      <div className="mt-2 max-h-64 divide-y divide-neutral-500/10 overflow-y-auto rounded-md ring-1 ring-inset ring-neutral-500/20">
        {shown.map((row) => (
          <AccountRow
            key={row.id}
            row={row}
            selected={isOn(row.id)}
            locked={lockedReasons.get(row.id)}
            onToggle={() => toggle(row.id)}
          />
        ))}
        {shown.length === 0 && (
          <div className="p-3 text-center text-xs text-neutral-500">No results for “{query}”</div>
        )}
      </div>
    </div>
  )
}
