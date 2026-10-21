'use client'

import clsx from 'clsx'
import Link from 'next/link'
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { FaPlus, FaRobot, FaUserPlus } from 'react-icons/fa'
import { MdSearchOff } from 'react-icons/md'
import {
  AppType,
  OrganisationMemberType,
  OrganisationType,
  RoleType,
  ServiceAccountType,
} from '@/apollo/graphql'
import { CreateServiceAccountDialog } from '@/app/[team]/access/service-accounts/_components/CreateServiceAccountDialog'
import { Avatar } from '@/components/common/Avatar'
import { Button } from '@/components/common/Button'
import { EmptyState } from '@/components/common/EmptyState'
import { RoleLabel } from '@/components/users/RoleLabel'
import { userHasPermission } from '@/utils/access/permissions'
import { AccessIndex, isGlobalAccessRole, roleBreakdown } from '@/utils/dashboard'
import {
  DashboardPanel,
  PANEL_ACTION,
  PanelLink,
  PanelSearch,
  PanelSkeleton,
} from './DashboardPanel'
import { CliSetup } from './CliSetup'
import { PersonalTokenButton, ServiceAccountTokenButton } from './TokenPopover'

const LIST_SIZE = 6

type Kind = 'members' | 'serviceAccounts'

const NOUNS: Record<Kind, [string, string]> = {
  members: ['member', 'members'],
  serviceAccounts: ['service account', 'service accounts'],
}

// Profile | token button | role and app access. The token button sits outside the row links.
const rowGrid = (tokenColumn: boolean) =>
  tokenColumn
    ? 'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 sm:grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1.6fr)]'
    : 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)]'

const DETAILS_GRID =
  'grid min-w-0 items-center gap-x-3 py-2 pr-3 sm:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)] sm:pr-4'

// A fixed avatar slot; the avatar's own right margin would overflow it
const AVATAR_SLOT = 'flex size-8 shrink-0 items-center justify-center [&>div]:mr-0'

type Row = {
  id: string
  href: string
  avatar: ReactNode
  name: string
  secondary?: string | null
  role?: RoleType | null
  appIds: string[]
  search: string
  /** What a token button on this row creates tokens for. */
  tokenFor?: { id: string; name: string }
  /** Listed first whenever the list isn't searched or filtered. */
  pinned?: boolean
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

const AccessList = (props: {
  kind: Kind
  active: boolean
  rows: Row[]
  query: string
  setQuery: (query: string) => void
  roleFilter: string | null
  setRoleFilter: (roleId: string | null) => void
  appNames: Map<string, string>
  totalApps: number
  prompt?: ReactNode
  /** Shown right below the pinned row. */
  afterPinned?: ReactNode
  empty: ReactNode
  renderToken?: (account: { id: string; name: string }) => ReactNode
}) => {
  const {
    kind,
    active,
    rows,
    query,
    setQuery,
    roleFilter,
    setRoleFilter,
    appNames,
    totalApps,
    prompt,
    afterPinned,
    empty,
    renderToken,
  } = props
  const [one, many] = NOUNS[kind]
  const searching = query.trim() !== ''
  const tokenColumn = !!renderToken && rows.some((row) => row.tokenFor)

  const roles = useMemo(() => roleBreakdown(rows), [rows])
  const activeRole = roles.some((r) => r.role.id === roleFilter) ? roleFilter : null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter(
        (row) => (!q || row.search.includes(q)) && (!activeRole || row.role?.id === activeRole)
      )
      .sort((a, b) => b.appIds.length - a.appIds.length || a.name.localeCompare(b.name))
  }, [rows, query, activeRole])

  const pinnedRows = !searching && !activeRole ? filtered.filter((row) => row.pinned) : []
  const unpinned = pinnedRows.length ? filtered.filter((row) => !row.pinned) : filtered

  // Owner and Admin reach every app by design: summarise them in one row
  // unless the list is being searched or filtered by role.
  const grouped = !searching && !activeRole && unpinned.length > LIST_SIZE
  const globalRows = grouped ? unpinned.filter((row) => isGlobalAccessRole(row.role)) : []
  const listRows = grouped ? unpinned.filter((row) => !isGlobalAccessRole(row.role)) : unpinned
  // The pinned row and the global access summary count towards the list size.
  const shown = listRows.slice(
    0,
    Math.max(LIST_SIZE - pinnedRows.length - (globalRows.length ? 1 : 0), 0)
  )
  const more = listRows.length - shown.length

  const renderRow = (row: Row) => (
    <li
      key={row.id}
      className={clsx(rowGrid(tokenColumn), 'transition-colors hover:bg-neutral-500/5')}
    >
      <Link
        href={row.href}
        prefetch={active ? undefined : false}
        className="flex min-w-0 items-center gap-2.5 py-2 pl-3 sm:pl-4"
      >
        <span className={AVATAR_SLOT}>{row.avatar}</span>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
            {row.name}
          </div>
          {row.secondary && (
            <div className="truncate text-2xs text-neutral-500">{row.secondary}</div>
          )}
        </div>
      </Link>
      {tokenColumn && (
        <div className="flex">
          {active && row.tokenFor ? renderToken!(row.tokenFor) : <span className="block size-7" />}
        </div>
      )}
      {/* Keeps the rest of the row clickable; the profile link above is the accessible one */}
      <Link href={row.href} prefetch={false} tabIndex={-1} aria-hidden className={DETAILS_GRID}>
        <div className="hidden sm:block">{row.role && <RoleLabel role={row.role} size="xs" />}</div>
        <AppAccess appIds={row.appIds} appNames={appNames} totalApps={totalApps} />
      </Link>
    </li>
  )
  const globalRoles = roles.filter(({ role }) => isGlobalAccessRole(role))

  return (
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
            <PanelSearch
              placeholder={`Search ${many}`}
              value={query}
              onChange={setQuery}
              className="w-36 sm:w-44"
            />
          )}
        </div>
      )}

      {shown.length || globalRows.length || pinnedRows.length ? (
        <ul className="divide-y divide-neutral-500/10 border-t border-neutral-500/20">
          {pinnedRows.map(renderRow)}
          {pinnedRows.length > 0 && afterPinned && (
            // Part of the pinned row, so no divider between them
            <li className="!border-t-0 px-3 pb-3 sm:px-4">{afterPinned}</li>
          )}
          {globalRows.length > 0 && (
            <li className={rowGrid(tokenColumn)}>
              <div className="flex min-w-0 items-center gap-2.5 py-2 pl-3 sm:pl-4">
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
              {tokenColumn && <span className="block size-7" />}
              <div className={DETAILS_GRID}>
                <div className="hidden flex-wrap gap-1 sm:flex">
                  {globalRoles.map(({ role }) => (
                    <RoleLabel key={role.id} role={role} size="xs" />
                  ))}
                </div>
                <div className="text-2xs text-neutral-500">All apps, by role</div>
              </div>
            </li>
          )}
          {shown.map(renderRow)}
        </ul>
      ) : (
        <div className="flex flex-1 flex-col justify-center">
          {searching ? (
            <EmptyState
              size="sm"
              icon={<MdSearchOff />}
              title={`No results for "${query.trim()}"`}
              subtitle="Try adjusting your search term"
            />
          ) : (
            empty
          )}
        </div>
      )}
      {prompt}
      {more > 0 && (
        <div className="border-t border-neutral-500/10 px-3 py-2 text-center text-2xs text-neutral-500 sm:px-4">
          {more} more {activeRole || searching ? 'matching ' : ''}
          {more === 1 ? one : many}, broadest access first
        </div>
      )}
    </>
  )
}

const AccessCard = (props: {
  kind: Kind
  title: string
  description: string
  rows?: Row[]
  actions?: ReactNode
  prompt?: ReactNode
  afterPinned?: ReactNode
  empty: ReactNode
  href: string
  appNames: Map<string, string>
  totalApps: number
  renderToken?: (target: { id: string; name: string }) => ReactNode
  className?: string
  children?: ReactNode
}) => {
  const { kind, title, description, rows, actions, href, className, children, ...list } = props
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string | null>(null)
  const many = NOUNS[kind][1]
  const withoutAccess = (rows ?? []).filter((row) => !row.appIds.length).length

  return (
    <DashboardPanel
      className={className}
      title={
        <>
          {title}
          {rows && <span className="ml-1.5 font-normal text-neutral-500">{rows.length}</span>}
        </>
      }
      description={description}
      actions={actions}
      footer={
        <>
          <span className="min-w-0 truncate text-2xs text-neutral-500">
            {withoutAccess > 0 && `${withoutAccess} without app access`}
          </span>
          <PanelLink href={href}>
            {rows && rows.length > LIST_SIZE ? `All ${rows.length} ${many}` : `Manage ${many}`}
          </PanelLink>
        </>
      }
    >
      {!rows ? (
        <PanelSkeleton rows={4} />
      ) : (
        <div className="grid h-full grid-cols-1">
          {/* An invisible, unfiltered copy sizes the cell, so filtering never resizes the card */}
          <div className="invisible col-start-1 row-start-1" inert>
            <AccessList
              {...list}
              kind={kind}
              active={false}
              rows={rows}
              query=""
              setQuery={setQuery}
              roleFilter={null}
              setRoleFilter={setRoleFilter}
            />
          </div>
          <div className="col-start-1 row-start-1 flex flex-col">
            <AccessList
              {...list}
              kind={kind}
              active
              rows={rows}
              query={query}
              setQuery={setQuery}
              roleFilter={roleFilter}
              setRoleFilter={setRoleFilter}
            />
          </div>
        </div>
      )}
      {children}
    </DashboardPanel>
  )
}

export const MembersOverview = (props: {
  team: string
  organisation: OrganisationType
  apps: AppType[]
  access: AccessIndex
  members?: OrganisationMemberType[]
  canInviteMembers: boolean
  /** The viewer has no personal access token yet. */
  needsPersonalToken?: boolean
  className?: string
}) => {
  const { team, organisation, apps, access, members, needsPersonalToken, className } = props
  const appNames = useMemo(() => new Map(apps.map((app) => [app.id, app.name])), [apps])
  const tokenButton = useRef<HTMLButtonElement>(null)

  const rows: Row[] | undefined = useMemo(
    () =>
      members?.map((member) => ({
        id: member.id,
        href: `/${team}/access/members/${member.id}`,
        avatar: <Avatar member={member} size="md" showTitle={false} />,
        name: `${member.fullName || member.email}${member.self ? ' (you)' : ''}`,
        secondary: member.fullName ? member.email : null,
        role: member.role,
        appIds: Array.from(access.members.get(member.id) ?? []),
        search: `${member.fullName ?? ''} ${member.email ?? ''}`.toLowerCase(),
        // Members can only create tokens for themselves
        tokenFor: member.self ? { id: member.id, name: member.email ?? '' } : undefined,
        pinned: !!member.self,
      })),
    [members, access, team]
  )

  // CLI setup sits under your row until you have a token (signing in to the CLI creates one),
  // unless you hide it. Read after mount: storage isn't available on the server.
  const cliHiddenKey = `cli-setup-hidden-${organisation.memberId}`
  const [cliHidden, setCliHidden] = useState<boolean | null>(null)
  useEffect(() => {
    try {
      setCliHidden(localStorage.getItem(cliHiddenKey) === 'true')
    } catch {
      setCliHidden(false)
    }
  }, [cliHiddenKey])
  const hideCliSetup = () => {
    setCliHidden(true)
    try {
      localStorage.setItem(cliHiddenKey, 'true')
    } catch {}
  }

  // Shown until someone else joins the organisation
  const invitePrompt = props.canInviteMembers && members && members.length <= 1 && (
    <div className="border-t border-neutral-500/10">
      <EmptyState
        size="sm"
        icon={<FaUserPlus />}
        title="Invite your team"
        subtitle="Invite members to collaborate with you and share secrets securely."
      >
        <Link href={`/${team}/access/members?invite=true`}>
          <Button variant="primary" icon={FaPlus}>
            Invite a member
          </Button>
        </Link>
      </EmptyState>
    </div>
  )

  return (
    <AccessCard
      kind="members"
      title="Members"
      description="People and the apps they can reach, directly or through a team"
      rows={rows}
      prompt={invitePrompt}
      afterPinned={
        needsPersonalToken &&
        cliHidden === false && (
          <CliSetup onCreateToken={() => tokenButton.current?.click()} onHide={hideCliSetup} />
        )
      }
      empty={null}
      href={`/${team}/access/members`}
      appNames={appNames}
      totalApps={apps.length}
      renderToken={(target) => (
        <PersonalTokenButton
          organisationId={organisation.id}
          subject={target.name.split('@')[0] || 'personal'}
          prompt={needsPersonalToken}
          triggerRef={tokenButton}
        />
      )}
      className={className}
    />
  )
}

export const ServiceAccountsOverview = (props: {
  team: string
  organisation: OrganisationType
  apps: AppType[]
  access: AccessIndex
  serviceAccounts?: ServiceAccountType[]
  canCreateServiceAccounts: boolean
  className?: string
}) => {
  const { team, organisation, apps, access, serviceAccounts, className } = props
  const appNames = useMemo(() => new Map(apps.map((app) => [app.id, app.name])), [apps])
  // Team accounts can grant tokens through the team's role, so they're checked when opened.
  const canMintOrgTokens = userHasPermission(
    organisation.role?.permissions,
    'ServiceAccountTokens',
    'create'
  )

  const rows: Row[] | undefined = useMemo(
    () =>
      serviceAccounts?.map((account) => ({
        id: account.id,
        href: `/${team}/access/service-accounts/${account.id}`,
        avatar: <Avatar serviceAccount={account} size="md" />,
        name: account.name,
        role: account.role,
        appIds: Array.from(access.serviceAccounts.get(account.id) ?? []),
        search: account.name.toLowerCase(),
        tokenFor:
          canMintOrgTokens || account.team ? { id: account.id, name: account.name } : undefined,
      })),
    [serviceAccounts, access, team, canMintOrgTokens]
  )

  // Mounted on first click so its queries don't run on every dashboard load.
  const [createKey, setCreateKey] = useState(0)
  const createAccount = () => setCreateKey((key) => key + 1)

  return (
    <AccessCard
      kind="serviceAccounts"
      title="Service accounts"
      description="Machine identities and the apps they can reach"
      rows={rows}
      actions={
        props.canCreateServiceAccounts &&
        !!rows?.length && (
          <button type="button" onClick={createAccount} className={PANEL_ACTION}>
            <FaPlus className="shrink-0" /> Create an account
          </button>
        )
      }
      empty={
        <EmptyState
          size="sm"
          icon={<FaRobot />}
          title="No service accounts yet"
          subtitle="Service accounts give machines and CI pipelines access to secrets."
        >
          {props.canCreateServiceAccounts && (
            <Button variant="primary" onClick={createAccount} icon={FaPlus}>
              Create an account
            </Button>
          )}
        </EmptyState>
      }
      href={`/${team}/access/service-accounts`}
      appNames={appNames}
      totalApps={apps.length}
      renderToken={(account) => (
        <ServiceAccountTokenButton organisation={organisation} account={account} team={team} />
      )}
      className={className}
    >
      {createKey > 0 && <CreateServiceAccountDialog key={createKey} autoOpen />}
    </AccessCard>
  )
}
