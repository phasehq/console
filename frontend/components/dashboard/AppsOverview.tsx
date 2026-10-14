'use client'

import clsx from 'clsx'
import Link from 'next/link'
import { ReactNode, useMemo, useState } from 'react'
import {
  FaClock,
  FaExclamationTriangle,
  FaHourglassEnd,
  FaMinusCircle,
  FaPlus,
  FaRobot,
  FaSearch,
  FaSyncAlt,
  FaTimesCircle,
  FaUsers,
} from 'react-icons/fa'
import {
  ApiEnvironmentSyncStatusChoices,
  AppType,
  EnvironmentSyncType,
  EnvironmentType,
} from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import {
  AccessIndex,
  AppSort,
  ENV_COLUMN_LABELS,
  EnvColumn,
  appNeedsAttention,
  descriptionPreview,
  filterApps,
  groupEnvironments,
  sortApps,
  SyncHealth,
  syncHealth,
} from '@/utils/dashboard'
import { DashboardPanel, PanelEmpty, PanelLink, PanelSkeleton } from './DashboardPanel'

const PAGE_SIZE = 10
const MAX_BADGES = 3
const SYNC_PRIORITY: Record<SyncHealth, number> = { failing: 0, pending: 1, skipped: 2, ok: 3 }

const SORTS: { value: AppSort; label: string }[] = [
  { value: 'updated', label: 'Recent' },
  { value: 'name', label: 'A–Z' },
  { value: 'syncs', label: 'Syncs' },
]

// Healthy syncs show only the provider icon; anything else gets a glyph.
const STATUS_GLYPHS: Partial<
  Record<ApiEnvironmentSyncStatusChoices, { icon: ReactNode; label: string }>
> = {
  [ApiEnvironmentSyncStatusChoices.Failed]: {
    icon: <FaTimesCircle className="text-red-500" />,
    label: 'Failed',
  },
  [ApiEnvironmentSyncStatusChoices.TimedOut]: {
    icon: <FaHourglassEnd className="text-amber-500" />,
    label: 'Timed out',
  },
  [ApiEnvironmentSyncStatusChoices.InProgress]: {
    icon: <FaSyncAlt className="text-sky-500" />,
    label: 'Syncing',
  },
  [ApiEnvironmentSyncStatusChoices.Queued]: {
    icon: <FaClock className="text-neutral-500" />,
    label: 'Queued',
  },
  [ApiEnvironmentSyncStatusChoices.Cancelled]: {
    icon: <FaMinusCircle className="text-neutral-500" />,
    label: 'Skipped',
  },
}

const SyncBadge = (props: { sync: EnvironmentSyncType; envName: string; href: string }) => {
  const { sync, envName, href } = props
  const glyph = STATUS_GLYPHS[sync.status as ApiEnvironmentSyncStatusChoices]
  const label = `${envName} → ${sync.serviceInfo?.name ?? 'Sync'}: ${glyph?.label ?? 'Synced'}`

  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className="relative inline-flex size-6 shrink-0 items-center justify-center rounded text-base transition-colors hover:bg-neutral-500/20"
    >
      <ProviderIcon providerId={sync.serviceInfo?.id ?? ''} />
      {glyph && (
        <span className="absolute -bottom-0.5 -right-0.5 flex rounded-full bg-zinc-100 p-px text-[0.5625rem] dark:bg-zinc-900">
          {glyph.icon}
        </span>
      )}
    </Link>
  )
}

const EnvChip = (props: {
  env: EnvironmentType
  envHref: string
  syncsHref: string
  showName: boolean
}) => {
  const { env, envHref, syncsHref, showName } = props
  const syncs = (env.syncs ?? []).filter(Boolean) as EnvironmentSyncType[]
  // At most three slots per chip, problems first so they stay visible.
  const shown = [...syncs]
    .sort((a, b) => SYNC_PRIORITY[syncHealth(a.status)] - SYNC_PRIORITY[syncHealth(b.status)])
    .slice(0, syncs.length > MAX_BADGES ? MAX_BADGES - 1 : MAX_BADGES)
  const hidden = syncs.length - shown.length

  return (
    <div className="inline-flex max-w-full items-center rounded-md bg-zinc-200 ring-1 ring-inset ring-neutral-500/20 dark:bg-white/5">
      {showName && (
        <Link
          href={envHref}
          title={`Open ${env.name}`}
          className="truncate px-1.5 text-2xs text-zinc-700 hover:text-emerald-600 dark:text-zinc-300 dark:hover:text-emerald-400"
        >
          {env.name}
        </Link>
      )}
      {shown.map((sync) => (
        <SyncBadge key={sync.id} sync={sync} envName={env.name} href={syncsHref} />
      ))}
      {hidden > 0 && (
        <Link
          href={syncsHref}
          title={`${hidden} more ${hidden === 1 ? 'sync' : 'syncs'}`}
          className="px-1 text-2xs text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          +{hidden}
        </Link>
      )}
      {syncs.length === 0 && !showName && (
        <Link
          href={envHref}
          title={`${env.name}: no syncs`}
          aria-label={`${env.name}: no syncs`}
          className="inline-flex size-6 items-center justify-center rounded transition-colors hover:bg-neutral-500/20"
        >
          <span className="size-1.5 rounded-full bg-neutral-400 dark:bg-neutral-600" />
        </Link>
      )}
    </div>
  )
}

const EnvCell = (props: {
  app: AppType
  envs: EnvironmentType[]
  column: EnvColumn
  team: string
}) => {
  const { app, envs, column, team } = props

  if (!envs.length)
    return (
      <span className="text-neutral-400 dark:text-neutral-600" title="No environment">
        –
      </span>
    )

  return (
    <div className="flex flex-wrap gap-1">
      {envs.map((env) => (
        <EnvChip
          key={env.id}
          env={env}
          envHref={`/${team}/apps/${app.id}/environments/${env.id}`}
          syncsHref={`/${team}/apps/${app.id}/syncing`}
          showName={column === 'OTHER' || envs.length > 1}
        />
      ))}
    </div>
  )
}

const AccessCell = (props: { app: AppType; access: AccessIndex; team: string }) => {
  const { app, access, team } = props
  const memberCount = access.appMembers.get(app.id)?.size ?? 0
  const accountCount = access.appServiceAccounts.get(app.id)?.size ?? 0
  const label = `${memberCount} ${memberCount === 1 ? 'member' : 'members'}, ${accountCount} service ${accountCount === 1 ? 'account' : 'accounts'}`

  return (
    <Link
      href={`/${team}/apps/${app.id}/access/members`}
      title={label}
      aria-label={label}
      className="inline-flex items-center justify-end gap-2.5 whitespace-nowrap text-2xs tabular-nums text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100"
    >
      <span className="inline-flex items-center gap-1">
        <FaUsers /> {memberCount}
      </span>
      <span className="inline-flex items-center gap-1">
        <FaRobot /> {accountCount}
      </span>
    </Link>
  )
}

const Legend = () => (
  <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-neutral-500 sm:flex">
    <span className="inline-flex items-center gap-1">
      <span className="size-1.5 rounded-full bg-neutral-400 dark:bg-neutral-600" /> No syncs
    </span>
    {[
      ApiEnvironmentSyncStatusChoices.Failed,
      ApiEnvironmentSyncStatusChoices.TimedOut,
      ApiEnvironmentSyncStatusChoices.InProgress,
    ].map((status) => (
      <span key={status} className="inline-flex items-center gap-1">
        {STATUS_GLYPHS[status]!.icon} {STATUS_GLYPHS[status]!.label}
      </span>
    ))}
  </div>
)

export const AppsOverview = (props: {
  team: string
  apps: AppType[]
  access: AccessIndex
  loading: boolean
  canReadApps: boolean
  canCreateApps: boolean
  className?: string
}) => {
  const { team, apps, access, loading, canReadApps, canCreateApps, className } = props
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<AppSort>('updated')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const attentionCount = useMemo(() => apps.filter(appNeedsAttention).length, [apps])
  const showAttention = attentionOnly && attentionCount > 0
  const rows = useMemo(
    () => sortApps(filterApps(apps, query, showAttention), sort),
    [apps, query, showAttention, sort]
  )
  const visibleRows = expanded || query ? rows : rows.slice(0, PAGE_SIZE)
  const showOther = apps.some((app) => groupEnvironments(app.environments ?? []).OTHER.length)
  const columns: EnvColumn[] = showOther
    ? ['DEV', 'STAGING', 'PROD', 'OTHER']
    : ['DEV', 'STAGING', 'PROD']

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        {apps.length > PAGE_SIZE && (
          <label className="relative flex items-center rounded-md bg-zinc-200 px-2 dark:bg-zinc-800">
            <FaSearch className="shrink-0 text-2xs text-neutral-500" />
            <input
              placeholder="Search apps"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="custom w-32 bg-transparent text-xs sm:w-40"
              aria-label="Search apps"
            />
          </label>
        )}
        {attentionCount > 0 && (
          <button
            type="button"
            onClick={() => setAttentionOnly(!attentionOnly)}
            aria-pressed={attentionOnly}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-medium ring-1 ring-inset transition-colors',
              attentionOnly
                ? 'bg-red-500/10 text-red-600 ring-red-500/40 dark:text-red-400'
                : 'text-neutral-500 ring-neutral-500/30 hover:text-red-500 hover:ring-red-500/40'
            )}
          >
            <FaExclamationTriangle /> {attentionCount} need attention
          </button>
        )}
      </div>
      <div
        className="flex rounded-full bg-zinc-200 p-0.5 dark:bg-zinc-800"
        role="group"
        aria-label="Sort apps"
      >
        {SORTS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setSort(option.value)}
            aria-pressed={sort === option.value}
            className={clsx(
              'rounded-full px-2.5 py-0.5 text-2xs font-medium transition-colors',
              sort === option.value
                ? 'bg-zinc-100 text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                : 'text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )

  const body = () => {
    if (!canReadApps)
      return <PanelEmpty title="You don't have permission to view apps in this organisation" />
    if (loading && !apps.length) return <PanelSkeleton rows={6} />
    if (!apps.length)
      return (
        <PanelEmpty title="No apps yet">
          {canCreateApps && (
            <Link href={`/${team}/apps?new=true`}>
              <Button variant="primary">
                <FaPlus /> Create an app
              </Button>
            </Link>
          )}
        </PanelEmpty>
      )
    return (
      <>
        {(apps.length > 5 || attentionCount > 0) && toolbar}
        {rows.length ? (
          matrix
        ) : (
          <PanelEmpty title={query ? `No apps match "${query}"` : 'No apps need attention'} />
        )}
      </>
    )
  }

  const matrix = (
    <>
      {/* Matrix: md and up */}
      <div className="hidden md:block">
        <table className="w-full table-fixed text-left text-xs">
          <colgroup>
            <col />
            {columns.map((column) => (
              <col
                key={column}
                className={column === 'OTHER' ? 'w-[16.5%]' : showOther ? 'w-[12.5%]' : 'w-[15%]'}
              />
            ))}
            <col className="w-[13%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-neutral-500/20 text-2xs text-neutral-500">
              <th className="px-4 pb-2 font-medium">App</th>
              {columns.map((column) => (
                <th key={column} className="px-1.5 pb-2 font-medium">
                  {ENV_COLUMN_LABELS[column]}
                </th>
              ))}
              <th className="pb-2 pl-2 pr-4 text-right font-medium">Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-500/10">
            {visibleRows.map((app) => {
              const groups = groupEnvironments(app.environments ?? [])
              return (
                <tr key={app.id} className="transition-colors hover:bg-neutral-500/5">
                  <td className="px-4 py-2 align-middle">
                    <Link
                      href={`/${team}/apps/${app.id}`}
                      className="block truncate text-xs font-medium text-zinc-900 hover:text-emerald-600 dark:text-zinc-100 dark:hover:text-emerald-400"
                    >
                      {app.name}
                    </Link>
                    {app.description && (
                      <div className="truncate text-2xs text-neutral-500">
                        {descriptionPreview(app.description)}
                      </div>
                    )}
                  </td>
                  {columns.map((column) => (
                    <td key={column} className="px-1.5 py-2 align-middle">
                      <EnvCell app={app} envs={groups[column]} column={column} team={team} />
                    </td>
                  ))}
                  <td className="py-2 pl-2 pr-4 text-right align-middle">
                    <AccessCell app={app} access={access} team={team} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Stacked list: below md */}
      <ul className="divide-y divide-neutral-500/10 border-t border-neutral-500/20 md:hidden">
        {visibleRows.map((app) => (
          <li key={app.id} className="space-y-2 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <Link
                href={`/${team}/apps/${app.id}`}
                className="min-w-0 truncate text-xs font-medium text-zinc-900 dark:text-zinc-100"
              >
                {app.name}
              </Link>
              <AccessCell app={app} access={access} team={team} />
            </div>
            <div className="flex flex-wrap gap-1">
              {(app.environments ?? []).filter(Boolean).map((env) => (
                <EnvChip
                  key={env!.id}
                  env={env!}
                  envHref={`/${team}/apps/${app.id}/environments/${env!.id}`}
                  syncsHref={`/${team}/apps/${app.id}/syncing`}
                  showName
                />
              ))}
            </div>
          </li>
        ))}
      </ul>

      {!query && rows.length > PAGE_SIZE && (
        <div className="border-t border-neutral-500/10 px-3 py-2 text-center sm:px-4">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-2xs font-medium text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            {expanded ? 'Show fewer' : `Show all ${rows.length} apps`}
          </button>
        </div>
      )}
    </>
  )

  return (
    <DashboardPanel
      className={className}
      title="Apps"
      description="Environments and the integrations their secrets sync to"
      footer={
        canReadApps && apps.length > 0 ? (
          <>
            <Legend />
            <PanelLink href={`/${team}/apps`}>All apps</PanelLink>
          </>
        ) : undefined
      }
    >
      {body()}
    </DashboardPanel>
  )
}
