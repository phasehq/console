'use client'

import clsx from 'clsx'
import Link from 'next/link'
import { ReactNode, useMemo, useState } from 'react'
import { FaSearch } from 'react-icons/fa'
import { FaPeopleGroup } from 'react-icons/fa6'
import {
  AppType,
  OrganisationMemberType,
  RoleType,
  ServiceAccountType,
  TeamType,
} from '@/apollo/graphql'
import { Avatar } from '@/components/common/Avatar'
import { RoleLabel } from '@/components/users/RoleLabel'
import { AccessIndex, isGlobalAccessRole, roleBreakdown } from '@/utils/dashboard'
import { DashboardPanel, PanelEmpty, PanelLink, PanelSkeleton } from './DashboardPanel'

const LIST_SIZE = 8

type Tab = 'members' | 'serviceAccounts' | 'teams'

type Row = {
  id: string
  href: string
  avatar: ReactNode
  name: string
  secondary?: string | null
  role?: RoleType | null
  appIds: string[]
  search: string
}

const AppAccess = (props: {
  appIds: string[]
  appNames: Map<string, string>
  totalApps: number
}) => {
  const { appIds, appNames, totalApps } = props
  const names = appIds
    .map((id) => appNames.get(id))
    .filter(Boolean)
    .sort() as string[]
  const all = totalApps > 1 && appIds.length === totalApps

  if (!appIds.length) return <div className="text-2xs text-neutral-500">No app access</div>

  return (
    <div className="min-w-0" title={names.join(', ')}>
      <div className="flex items-center gap-2">
        <div className="hidden h-1 flex-1 rounded-full bg-emerald-500/15 sm:block">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${(appIds.length / Math.max(totalApps, 1)) * 100}%` }}
          />
        </div>
        <span className="shrink-0 text-2xs text-neutral-500">
          {all ? 'All apps' : `${appIds.length} ${appIds.length === 1 ? 'app' : 'apps'}`}
        </span>
      </div>
      {!all && (
        <div className="hidden truncate text-2xs text-neutral-500 sm:block">
          {names.slice(0, 2).join(', ')}
          {names.length > 2 && ` +${names.length - 2}`}
        </div>
      )}
    </div>
  )
}

export const AccessOverview = (props: {
  team: string
  apps: AppType[]
  access: AccessIndex
  members?: OrganisationMemberType[]
  serviceAccounts?: ServiceAccountType[]
  teams?: TeamType[]
  canReadMembers: boolean
  canReadServiceAccounts: boolean
  canReadTeams: boolean
  className?: string
}) => {
  const { team, apps, access, members, serviceAccounts, teams, className } = props
  const tabs = [
    props.canReadMembers && { key: 'members', label: 'Members', count: members?.length },
    props.canReadServiceAccounts && {
      key: 'serviceAccounts',
      label: 'Service accounts',
      count: serviceAccounts?.length,
    },
    props.canReadTeams && !!teams?.length && { key: 'teams', label: 'Teams', count: teams.length },
  ].filter(Boolean) as { key: Tab; label: string; count?: number }[]
  const [selected, setSelected] = useState<Tab | null>(null)
  const tab = tabs.find((t) => t.key === selected)?.key ?? tabs[0]?.key
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string | null>(null)

  const appNames = useMemo(() => new Map(apps.map((app) => [app.id, app.name])), [apps])

  const rows: Row[] | undefined = useMemo(() => {
    if (tab === 'members')
      return members?.map((member) => ({
        id: member.id,
        href: `/${team}/access/members/${member.id}`,
        avatar: <Avatar member={member} size="md" showTitle={false} />,
        name: `${member.fullName || member.email}${member.self ? ' (you)' : ''}`,
        secondary: member.fullName ? member.email : null,
        role: member.role,
        appIds: Array.from(access.members.get(member.id) ?? []),
        search: `${member.fullName ?? ''} ${member.email ?? ''}`.toLowerCase(),
      }))
    if (tab === 'serviceAccounts')
      return serviceAccounts?.map((account) => ({
        id: account.id,
        href: `/${team}/access/service-accounts/${account.id}`,
        avatar: <Avatar serviceAccount={account} size="md" />,
        name: account.name,
        role: account.role,
        appIds: Array.from(access.serviceAccounts.get(account.id) ?? []),
        search: account.name.toLowerCase(),
      }))
    if (tab === 'teams')
      return teams?.map((t) => {
        const people = (t.members ?? []).filter((m) => m.orgMember).length
        const machines = (t.members ?? []).filter((m) => m.serviceAccount).length
        return {
          id: t.id,
          href: `/${team}/access/teams/${t.id}`,
          avatar: (
            <span className="flex size-8 items-center justify-center rounded-full bg-zinc-200 text-neutral-500 dark:bg-zinc-700">
              <FaPeopleGroup />
            </span>
          ),
          name: t.name,
          secondary: `${people} ${people === 1 ? 'member' : 'members'}${machines ? ` · ${machines} service ${machines === 1 ? 'account' : 'accounts'}` : ''}`,
          appIds: (t.apps ?? []).map((app) => app.id).filter((id) => appNames.has(id)),
          search: t.name.toLowerCase(),
        }
      })
    return undefined
  }, [tab, members, serviceAccounts, teams, access, team, appNames])

  const roles = useMemo(() => (tab === 'teams' ? [] : roleBreakdown(rows ?? [])), [rows, tab])
  const activeRole = roles.some((r) => r.role.id === roleFilter) ? roleFilter : null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? [])
      .filter(
        (row) => (!q || row.search.includes(q)) && (!activeRole || row.role?.id === activeRole)
      )
      .sort((a, b) => b.appIds.length - a.appIds.length || a.name.localeCompare(b.name))
  }, [rows, query, activeRole])

  const withoutAccess = (rows ?? []).filter((row) => !row.appIds.length).length
  // Owner and Admin reach every app by design: summarise them in one row
  // unless the list is being searched or filtered by role.
  const grouped = !query.trim() && !activeRole && filtered.length > LIST_SIZE
  const globalRows = grouped ? filtered.filter((row) => isGlobalAccessRole(row.role)) : []
  const listRows = grouped ? filtered.filter((row) => !isGlobalAccessRole(row.role)) : filtered
  const shown = listRows.slice(0, LIST_SIZE)
  const globalRoles = roles.filter(({ role }) => isGlobalAccessRole(role))
  const listHref = {
    members: `/${team}/access/members`,
    serviceAccounts: `/${team}/access/service-accounts`,
    teams: `/${team}/access/teams`,
  }[tab ?? 'members']
  const noun = { members: 'members', serviceAccounts: 'service accounts', teams: 'teams' }[
    tab ?? 'members'
  ]

  const selectTab = (key: Tab) => {
    setSelected(key)
    setQuery('')
    setRoleFilter(null)
  }

  return (
    <DashboardPanel
      className={className}
      title="Access"
      description="Who can reach which apps, directly or through a team"
      actions={
        tabs.length > 1 && (
          <div className="flex rounded-full bg-zinc-200 p-0.5 dark:bg-zinc-800" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => selectTab(t.key)}
                className={clsx(
                  'rounded-full px-2.5 py-0.5 text-2xs font-medium transition-colors',
                  tab === t.key
                    ? 'bg-zinc-100 text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                    : 'text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100'
                )}
              >
                {t.label}
                {t.count !== undefined && <span className="ml-1 text-neutral-500">{t.count}</span>}
              </button>
            ))}
          </div>
        )
      }
      footer={
        tab && (
          <>
            <span className="text-2xs text-neutral-500">
              {withoutAccess > 0 && `${withoutAccess} ${noun} without app access`}
            </span>
            <PanelLink href={listHref}>
              {rows && rows.length > LIST_SIZE ? `All ${rows.length} ${noun}` : `Manage ${noun}`}
            </PanelLink>
          </>
        )
      }
    >
      {!tab ? (
        <PanelEmpty title="You don't have permission to view members or service accounts" />
      ) : !rows ? (
        <PanelSkeleton rows={6} />
      ) : (
        <>
          {(roles.length > 1 || rows.length > LIST_SIZE) && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 sm:px-4">
              <div className="flex flex-wrap items-center gap-1.5">
                {roles.length > 1 &&
                  roles.map(({ role, count }) => (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => setRoleFilter(activeRole === role.id ? null : role.id)}
                      aria-pressed={activeRole === role.id}
                      title={`Show ${role.name} only`}
                      className={clsx(
                        'inline-flex items-center gap-1.5 rounded-md py-0.5 pl-0.5 pr-1.5 ring-1 ring-inset transition',
                        activeRole === role.id
                          ? 'bg-zinc-200 ring-neutral-500/60 dark:bg-zinc-700'
                          : 'ring-transparent hover:ring-neutral-500/30',
                        activeRole && activeRole !== role.id && 'opacity-50'
                      )}
                    >
                      <RoleLabel role={role} size="xs" />
                      <span className="text-2xs tabular-nums text-neutral-500">{count}</span>
                    </button>
                  ))}
              </div>
              {rows.length > LIST_SIZE && (
                <label className="relative flex items-center rounded-md bg-zinc-200 px-2 dark:bg-zinc-800">
                  <FaSearch className="shrink-0 text-2xs text-neutral-500" />
                  <input
                    placeholder={`Search ${noun}`}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="custom w-36 bg-transparent text-xs sm:w-44"
                    aria-label={`Search ${noun}`}
                  />
                </label>
              )}
            </div>
          )}

          {shown.length || globalRows.length ? (
            <ul className="divide-y divide-neutral-500/10 border-t border-neutral-500/20">
              {globalRows.length > 0 && (
                <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.6fr)_minmax(0,1fr)] sm:px-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex shrink-0 items-center">
                      {globalRows.slice(0, 4).map((row, i) => (
                        <span
                          key={row.id}
                          className={clsx(
                            'flex rounded-full ring-2 ring-zinc-100 dark:ring-zinc-800',
                            i > 0 && '-ml-3'
                          )}
                        >
                          {row.avatar}
                        </span>
                      ))}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                        {globalRows.length} with global access
                      </div>
                      <div className="truncate text-2xs text-neutral-500">
                        {globalRows.map((row) => row.name).join(', ')}
                      </div>
                    </div>
                  </div>
                  <div className="hidden flex-wrap gap-1 sm:flex">
                    {globalRoles.map(({ role }) => (
                      <RoleLabel key={role.id} role={role} size="xs" />
                    ))}
                  </div>
                  <div className="text-2xs text-neutral-500">All apps, by role</div>
                </li>
              )}
              {shown.map((row) => (
                <li key={row.id}>
                  <Link
                    href={row.href}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2 transition-colors hover:bg-neutral-500/5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.6fr)_minmax(0,1fr)] sm:px-4"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center">
                        {row.avatar}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                          {row.name}
                        </div>
                        {row.secondary && (
                          <div className="truncate text-2xs text-neutral-500">{row.secondary}</div>
                        )}
                      </div>
                    </div>
                    <div className="hidden sm:block">
                      {row.role && <RoleLabel role={row.role} size="xs" />}
                    </div>
                    <AppAccess appIds={row.appIds} appNames={appNames} totalApps={apps.length} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <PanelEmpty title={query ? `No ${noun} match "${query}"` : `No ${noun} yet`} />
          )}
          {listRows.length > shown.length && (
            <div className="border-t border-neutral-500/10 px-3 py-2 text-center text-2xs text-neutral-500 sm:px-4">
              {listRows.length - shown.length} more {activeRole || query ? 'matching ' : ''}
              {noun}, broadest access first
            </div>
          )}
        </>
      )}
    </DashboardPanel>
  )
}
