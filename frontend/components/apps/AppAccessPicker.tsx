'use client'

import { memo, ReactNode, useCallback, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { FaCircle, FaSearch, FaTimesCircle } from 'react-icons/fa'
import { OrganisationMemberType, RoleType, ServiceAccountType } from '@/apollo/graphql'
import { Avatar } from '@/components/common/Avatar'
import { Checkbox } from '@/components/common/Checkbox'
import { RoleLabel } from '@/components/users/RoleLabel'

/** An environment as the picker shows it: `key` stays the same while its name is edited */
export type AccessEnvironment = { key: string; name: string; color: string }

/** The environments each account is given, by account id and environment key */
export type AccessScope = ReadonlyMap<string, ReadonlySet<string>>

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
  /** Every environment, whatever is chosen here: why */
  everywhere?: string
  /** No environment can be given yet: why */
  unavailable?: string
}

const NONE: ReadonlySet<string> = new Set()

const AccountRow = memo(function AccountRow({
  row,
  envKeys,
  given,
  columns,
  onSet,
}: {
  row: Row
  envKeys: string[]
  given: ReadonlySet<string>
  columns: string
  onSet: (id: string, envKeys: string[], on: boolean) => void
}) {
  const fixed = row.everywhere ?? row.unavailable
  const isOn = (key: string) => (row.everywhere ? true : !row.unavailable && given.has(key))
  const count = envKeys.filter(isOn).length
  const all = count === envKeys.length && count > 0

  return (
    <div
      role="row"
      title={fixed}
      className="grid items-center border-t border-neutral-500/10 first:border-t-0"
      style={{ gridTemplateColumns: columns }}
    >
      <div
        role="rowheader"
        className="sticky left-0 z-[1] flex min-w-0 items-center gap-3 bg-neutral-100 px-2 py-1 dark:bg-neutral-900"
      >
        <Checkbox
          size="sm"
          checked={all}
          indeterminate={count > 0}
          disabled={Boolean(fixed)}
          onChange={(on) => onSet(row.id, envKeys, on)}
          aria-label={`${row.name}: every Environment`}
        />
        {row.avatar}
        <span className="min-w-0 flex-1">
          <span
            className={clsx(
              'block truncate text-sm font-medium',
              row.unavailable ? 'text-neutral-500' : 'text-zinc-900 dark:text-zinc-100'
            )}
          >
            {row.name}
          </span>
          {(fixed || row.detail) && (
            <span className="block truncate text-2xs text-neutral-500">{fixed ?? row.detail}</span>
          )}
        </span>
        {row.role && (
          <span className="max-w-28 shrink-0">
            <RoleLabel role={row.role} size="xs" />
          </span>
        )}
      </div>
      {envKeys.map((key) => (
        <div key={key} role="gridcell" className="flex justify-center">
          <Checkbox
            size="sm"
            checked={isOn(key)}
            disabled={Boolean(fixed)}
            onChange={(on) => onSet(row.id, [key], on)}
            aria-label={`${row.name}: ${key}`}
          />
        </div>
      ))}
    </div>
  )
})

type AppAccessPickerProps = {
  members: OrganisationMemberType[]
  serviceAccounts: ServiceAccountType[]
  environments: AccessEnvironment[]
  scope: AccessScope
  /** Accounts that get every environment whatever is chosen here, each with the reason */
  everywhere: ReadonlyMap<string, string>
  /** Accounts that can't be given any environment yet, each with the reason */
  unavailable: ReadonlyMap<string, string>
  onChange: (scope: Map<string, ReadonlySet<string>>) => void
}

/**
 * Chooses which members and service accounts can reach which of a new App's environments: a row
 * per account, a column per environment. Built for organisations with hundreds of accounts: one
 * tab per kind, a search, and ticks for a whole row or column at once.
 */
export const AppAccessPicker = ({
  members,
  serviceAccounts,
  environments,
  scope,
  everywhere,
  unavailable,
  onChange,
}: AppAccessPickerProps) => {
  const [pickedTab, setTab] = useState<'members' | 'services' | null>(null)
  const [query, setQuery] = useState('')

  const lists = useMemo(() => {
    // Accounts that reach everything come first; the rest by name
    const ordered = (rows: Row[]) => [
      ...rows.filter((row) => row.everywhere),
      ...rows
        .filter((row) => !row.everywhere)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    ]
    return {
      members: ordered(
        members.map((member) => ({
          id: member.id,
          name: member.fullName || member.email || '',
          detail: member.fullName ? member.email : null,
          role: member.role,
          avatar: <Avatar member={member} size="sm" />,
          everywhere: everywhere.get(member.id),
          unavailable: unavailable.get(member.id),
        }))
      ),
      services: ordered(
        serviceAccounts.map((account) => ({
          id: account.id,
          name: account.name,
          role: account.role,
          avatar: <Avatar serviceAccount={account} size="sm" />,
          everywhere: everywhere.get(account.id),
          unavailable: unavailable.get(account.id),
        }))
      ),
    }
  }, [members, serviceAccounts, everywhere, unavailable])

  // Members unless another tab was picked: the two lists can arrive one after the other
  const tab =
    pickedTab && lists[pickedTab].length > 0
      ? pickedTab
      : lists.members.length > 0
        ? 'members'
        : 'services'
  const rows = lists[tab]
  const search = query.trim().toLowerCase()
  const shown = search
    ? rows.filter((row) => `${row.name} ${row.detail ?? ''}`.toLowerCase().includes(search))
    : rows
  // Whole rows and columns act on the accounts shown that can be chosen for
  const open = shown.filter((row) => !row.everywhere && !row.unavailable)

  const envKeys = environments.map((env) => env.key)
  const givenTo = (row: Row) => scope.get(row.id) ?? NONE
  const hasAccess = (row: Row) =>
    Boolean(row.everywhere) || (!row.unavailable && envKeys.some((key) => givenTo(row).has(key)))

  // Read through a ref so the rows' handler stays the same between renders
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  /** Gives (or takes away) these environments to (or from) each of these accounts */
  const setFor = useCallback((ids: string[], keys: string[], on: boolean) => {
    const next = new Map(scopeRef.current)
    for (const id of ids) {
      const envs = new Set(next.get(id) ?? NONE)
      for (const key of keys) on ? envs.add(key) : envs.delete(key)
      if (envs.size > 0) next.set(id, envs)
      else next.delete(id)
    }
    onChangeRef.current(next)
  }, [])
  const setRow = useCallback(
    (id: string, keys: string[], on: boolean) => setFor([id], keys, on),
    [setFor]
  )

  const countIn = (key: string) => open.filter((row) => givenTo(row).has(key)).length
  const ticked = open.reduce(
    (sum, row) => sum + envKeys.filter((key) => givenTo(row).has(key)).length,
    0
  )
  const cells = open.length * envKeys.length

  const tabs = [
    { id: 'members' as const, label: 'Members', rows: lists.members },
    { id: 'services' as const, label: 'Service Accounts', rows: lists.services },
  ].filter((t) => t.rows.length > 0)

  // The account column takes what's left; each environment gets a fixed column, scrolling sideways
  // past what the dialog fits. The floor is set outright: sized to its content, a long line under an
  // account's name would widen the grid instead of being cut short
  const columns = `minmax(14rem, 1fr) repeat(${environments.length}, 6.5rem)`
  const minWidth = `calc(14rem + ${environments.length} * 6.5rem)`

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
                {t.rows.filter(hasAccess).length}/{t.rows.length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {rows.length > SEARCH_FROM && (
        <div className="relative mt-2 flex items-center gap-2 rounded-md bg-zinc-100 px-2 ring-1 ring-inset ring-neutral-500/40 dark:bg-zinc-800">
          <FaSearch className="shrink-0 text-xs text-neutral-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'members' ? 'Search Members' : 'Search Service Accounts'}
            className="custom w-full bg-transparent text-sm text-zinc-900 placeholder:text-neutral-500 dark:text-zinc-100"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear the search"
              onClick={() => setQuery('')}
              className="absolute right-2 text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              <FaTimesCircle className="text-xs" />
            </button>
          )}
        </div>
      )}

      <div
        role="grid"
        aria-label={tab === 'members' ? 'Members' : 'Service Accounts'}
        // A border, not an inset ring: the sticky column's background would paint over a ring
        className="mt-2 max-h-[22rem] overflow-auto rounded-md border border-neutral-500/20"
      >
        <div style={{ minWidth }}>
          <div
            role="row"
            className="sticky top-0 z-[2] grid items-center border-b border-neutral-500/20 bg-neutral-100 dark:bg-neutral-900"
            style={{ gridTemplateColumns: columns }}
          >
            <div
              role="columnheader"
              className="sticky left-0 z-[1] flex items-center gap-3 bg-neutral-100 px-2 py-2 dark:bg-neutral-900"
            >
              <Checkbox
                size="sm"
                checked={cells > 0 && ticked === cells}
                indeterminate={ticked > 0}
                disabled={cells === 0}
                onChange={(on) =>
                  setFor(
                    open.map((row) => row.id),
                    envKeys,
                    on
                  )
                }
                aria-label="Every account shown: every Environment"
                title={search ? 'Every account shown, every Environment' : 'Everyone, every Environment'}
              />
              <span className="text-2xs font-medium uppercase tracking-wide text-neutral-500">
                {search ? `${shown.length} of ${rows.length}` : tab === 'members' ? 'Member' : 'Service Account'}
              </span>
            </div>
            {environments.map((env) => {
              const count = countIn(env.key)
              return (
                <div
                  key={env.key}
                  role="columnheader"
                  className="flex min-w-0 flex-col items-center gap-1 px-1 py-1.5"
                >
                  <span
                    className="flex w-full min-w-0 items-center justify-center gap-1 text-2xs font-medium text-zinc-700 dark:text-zinc-300"
                    title={env.name}
                  >
                    <FaCircle className="shrink-0 text-[6px]" style={{ color: env.color }} />
                    <span className="truncate">{env.name || 'Unnamed'}</span>
                  </span>
                  <Checkbox
                    size="sm"
                    checked={open.length > 0 && count === open.length}
                    indeterminate={count > 0}
                    disabled={open.length === 0}
                    onChange={(on) =>
                      setFor(
                        open.map((row) => row.id),
                        [env.key],
                        on
                      )
                    }
                    aria-label={`Every account shown: ${env.name}`}
                    title={`${search ? 'Every account shown' : 'Everyone'}: ${env.name}`}
                  />
                </div>
              )
            })}
          </div>

          {shown.map((row) => (
            <AccountRow
              key={row.id}
              row={row}
              envKeys={envKeys}
              given={givenTo(row)}
              columns={columns}
              onSet={setRow}
            />
          ))}
          {shown.length === 0 && (
            <div className="p-3 text-center text-xs text-neutral-500">No results for “{query}”</div>
          )}
        </div>
      </div>
    </div>
  )
}
