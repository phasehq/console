'use client'

import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import clsx from 'clsx'
import Link from 'next/link'
import { ReactNode, createContext, useContext, useLayoutEffect, useMemo, useState } from 'react'
import {
  FaBan,
  FaBoxOpen,
  FaChevronDown,
  FaClock,
  FaCubes,
  FaExclamationTriangle,
  FaHourglassEnd,
  FaMinusCircle,
  FaPauseCircle,
  FaPlus,
  FaRobot,
  FaSyncAlt,
  FaTimesCircle,
  FaUsers,
} from 'react-icons/fa'
import { MdSearchOff } from 'react-icons/md'
import {
  ApiEnvironmentSyncStatusChoices,
  AppType,
  EnvironmentSyncType,
  EnvironmentType,
} from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { EmptyState } from '@/components/common/EmptyState'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import {
  AccessIndex,
  AppSort,
  appSyncs,
  EnvColumn,
  envColumnLayout,
  envColumns,
  fitSharedColumns,
  appNeedsAttention,
  descriptionPreview,
  filterApps,
  groupEnvironments,
  rankByQuery,
  ServiceUsage,
  sortApps,
  SyncDetail,
  SyncHealth,
  syncHealth,
  syncServiceId,
  syncServices,
} from '@/utils/dashboard'
import { syncDestination } from '@/utils/syncing/destination'
import { relativeTimeFromDates } from '@/utils/time'
import {
  DashboardPanel,
  PanelLink,
  PanelSearch,
  PanelSkeleton,
  StableHeight,
} from './DashboardPanel'

const PAGE_SIZE = 6
// Minimum column widths in px, and the most shared-name columns to show.
const MATRIX = { app: 160, env: 88, other: 120, access: 96, maxShared: 3 }
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

// A paused sync doesn't run, so its last result doesn't count.
const PAUSED_GLYPH = { icon: <FaPauseCircle className="text-neutral-500" />, label: 'Paused' }

// What the badges show: details from the sync overview query, and the integration filtered by.
const SyncView = createContext<{ details: Map<string, SyncDetail>; service: string | null }>({
  details: new Map(),
  service: null,
})

const syncGlyph = (sync: EnvironmentSyncType, detail?: SyncDetail) =>
  detail?.isActive === false
    ? PAUSED_GLYPH
    : STATUS_GLYPHS[sync.status as ApiEnvironmentSyncStatusChoices]

const SyncBadge = (props: { sync: EnvironmentSyncType; envName: string; href: string }) => {
  const { sync, envName, href } = props
  const { details, service } = useContext(SyncView)
  const detail = details.get(sync.id)
  const glyph = syncGlyph(sync, detail)
  const destination = detail ? syncDestination(syncServiceId(sync), detail.options) : null
  // "Production → GitHub Actions: acme/web · Failed · last run 2 hours ago"
  const label = [
    `${envName} → ${sync.serviceInfo?.name ?? 'Sync'}${destination ? `: ${destination}` : ''}`,
    glyph?.label ?? 'Synced',
    detail?.lastSync && `last run ${relativeTimeFromDates(new Date(detail.lastSync))}`,
  ]
    .filter(Boolean)
    .join(' · ')
  // Filtering by an integration fades the other services' badges
  const faded = !!service && syncServiceId(sync) !== service

  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className={clsx(
        'relative inline-flex size-6 shrink-0 items-center justify-center rounded text-base transition hover:bg-neutral-500/20',
        faded && 'opacity-25'
      )}
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
  const { service } = useContext(SyncView)
  // At most three slots per chip: the filtered integration, then problems, stay visible.
  const rank = (sync: EnvironmentSyncType) =>
    (service && syncServiceId(sync) !== service ? MAX_BADGES * 10 : 0) +
    SYNC_PRIORITY[syncHealth(sync.status)]
  const shown = [...syncs]
    .sort((a, b) => rank(a) - rank(b))
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
          showName={column.key === 'OTHER' || envs.length > 1}
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

/** Minimums scale down on narrow tables; spare room goes to App (up to 30%), then env columns. */
const matrixWidths = (width: number, envCount: number, hasOther: boolean) => {
  const other = hasOther ? MATRIX.other : 0
  const minimum = MATRIX.app + MATRIX.access + other + envCount * MATRIX.env
  if (width <= minimum) {
    const scale = width / minimum
    return { env: MATRIX.env * scale, other: other * scale, access: MATRIX.access * scale }
  }
  const app = Math.min(Math.max(width * 0.3, MATRIX.app), width - minimum + MATRIX.app)
  return { env: (width - app - MATRIX.access - other) / envCount, other, access: MATRIX.access }
}

const Legend = ({ paused }: { paused: boolean }) => (
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
    {paused && (
      <span className="inline-flex items-center gap-1">
        {PAUSED_GLYPH.icon} {PAUSED_GLYPH.label}
      </span>
    )}
  </div>
)

/** Narrows the apps to those syncing to one integration. */
const ServiceFilter = (props: {
  services: ServiceUsage[]
  value: string | null
  onChange: (serviceId: string | null) => void
}) => {
  const { services, value, onChange } = props
  const selected = services.find((service) => service.id === value)
  const item =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-2xs data-[focus]:bg-neutral-500/10'

  return (
    <Menu>
      <MenuButton
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-medium ring-1 ring-inset transition-colors',
          selected
            ? 'bg-zinc-200 text-zinc-900 ring-neutral-500/40 dark:bg-zinc-700 dark:text-zinc-100'
            : 'text-neutral-500 ring-neutral-500/30 hover:text-zinc-900 dark:hover:text-zinc-100'
        )}
      >
        {selected && (
          <span className="flex text-xs">
            <ProviderIcon providerId={selected.id} />
          </span>
        )}
        {selected ? selected.name : 'All integrations'}
        <FaChevronDown className="shrink-0 text-3xs" />
      </MenuButton>
      <MenuItems
        anchor={{ to: 'bottom start', gap: 6 }}
        className="z-20 max-h-72 w-60 overflow-y-auto rounded-lg bg-zinc-100 p-1 shadow-xl ring-1 ring-inset ring-neutral-500/20 focus:outline-none dark:bg-zinc-800"
      >
        <MenuItem>
          <button type="button" onClick={() => onChange(null)} className={item}>
            <span className="min-w-0 flex-1 truncate text-zinc-900 dark:text-zinc-100">
              All integrations
            </span>
          </button>
        </MenuItem>
        {services.map((service) => (
          <MenuItem key={service.id}>
            <button type="button" onClick={() => onChange(service.id)} className={item}>
              <span className="flex shrink-0 text-sm">
                <ProviderIcon providerId={service.id} />
              </span>
              <span className="min-w-0 flex-1 truncate text-zinc-900 dark:text-zinc-100">
                {service.name}
              </span>
              <span className="shrink-0 tabular-nums text-neutral-500">
                {service.apps} {service.apps === 1 ? 'app' : 'apps'}
              </span>
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  )
}

const NO_DETAILS = new Map<string, SyncDetail>()

export const AppsOverview = (props: {
  team: string
  apps: AppType[]
  access: AccessIndex
  loading: boolean
  canReadApps: boolean
  canCreateApps: boolean
  /** Destination, last run and paused state per sync id, once loaded. */
  syncDetails?: Map<string, SyncDetail>
  className?: string
}) => {
  const { team, apps, access, loading, canReadApps, canCreateApps, className } = props
  const syncDetails = props.syncDetails ?? NO_DETAILS
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<AppSort>('updated')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [service, setService] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const attentionCount = useMemo(() => apps.filter(appNeedsAttention).length, [apps])
  const showAttention = attentionOnly && attentionCount > 0
  const services = useMemo(() => syncServices(apps), [apps])
  const activeService = services.some((s) => s.id === service) ? service : null
  const searching = query.trim() !== ''
  const filtered = searching || showAttention || !!activeService
  const rows = useMemo(
    () => rankByQuery(sortApps(filterApps(apps, query, showAttention, activeService), sort), query),
    [apps, query, showAttention, activeService, sort]
  )
  const view = useMemo(
    () => ({ details: syncDetails, service: activeService }),
    [syncDetails, activeService]
  )
  const hasPaused = useMemo(
    () =>
      apps.some((app) =>
        appSyncs(app).some((sync) => syncDetails.get(sync.id)?.isActive === false)
      ),
    [apps, syncDetails]
  )
  const visibleRows = expanded ? rows : rows.slice(0, PAGE_SIZE)
  const hasDescriptions = apps.some((app) => app.description)

  const [matrixEl, setMatrixEl] = useState<HTMLDivElement | null>(null)
  const [matrixWidth, setMatrixWidth] = useState(0)
  useLayoutEffect(() => {
    if (!matrixEl) return
    const measure = () => setMatrixWidth(matrixEl.getBoundingClientRect().width)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(matrixEl)
    return () => observer.disconnect()
  }, [matrixEl])

  const layout = useMemo(() => envColumnLayout(apps), [apps])
  const columns = envColumns(layout, fitSharedColumns(layout, matrixWidth, MATRIX))
  const hasOther = columns.some((column) => column.key === 'OTHER')
  const envCount = columns.length - (hasOther ? 1 : 0)
  const widths = matrixWidth ? matrixWidths(matrixWidth, envCount, hasOther) : undefined

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        {apps.length > PAGE_SIZE && (
          <PanelSearch
            placeholder="Search apps"
            value={query}
            onChange={(value) => {
              setQuery(value)
              setExpanded(false)
            }}
            className="w-32 sm:w-40"
          />
        )}
        {attentionCount > 0 && (
          <button
            type="button"
            onClick={() => {
              setAttentionOnly(!attentionOnly)
              setExpanded(false)
            }}
            aria-pressed={attentionOnly}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-medium ring-1 ring-inset transition-colors',
              attentionOnly
                ? 'bg-amber-500/30 text-amber-800 ring-amber-500 dark:text-amber-200'
                : 'bg-amber-500/10 text-amber-700 ring-amber-500/40 hover:bg-amber-500/20 dark:text-amber-400'
            )}
          >
            <FaExclamationTriangle /> {attentionCount}{' '}
            {attentionCount === 1 ? 'needs attention' : 'need attention'}
          </button>
        )}
        {services.length > 1 && (
          <ServiceFilter
            services={services}
            value={activeService}
            onChange={(id) => {
              setService(id)
              setExpanded(false)
            }}
          />
        )}
      </div>
      <div
        className="flex rounded-full bg-zinc-200 p-0.5 dark:bg-zinc-800"
        role="group"
        aria-label="Sort apps"
      >
        {SORTS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setSort(value)}
            aria-pressed={sort === value}
            className={clsx(
              'rounded-full px-2.5 py-0.5 text-2xs font-semibold transition-colors',
              sort === value
                ? 'bg-zinc-100 text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                : 'text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100'
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )

  const body = () => {
    if (!canReadApps)
      return (
        <EmptyState
          size="sm"
          icon={<FaBan />}
          title="Access restricted"
          subtitle="You don't have the permissions required to view Apps in this organisation."
        />
      )
    if (loading && !apps.length) return <PanelSkeleton rows={6} />
    if (!apps.length)
      return (
        <EmptyState
          size="sm"
          icon={<FaBoxOpen />}
          title="No apps"
          subtitle="Create an app to start managing secrets."
        >
          {canCreateApps && (
            <Link href={`/${team}/apps?new=true`}>
              <Button variant="primary" icon={FaPlus}>
                Create an app
              </Button>
            </Link>
          )}
        </EmptyState>
      )
    return (
      <StableHeight
        enabled={!expanded}
        resetKey={columns.map((column) => column.key).join()}
        empty={
          !rows.length && (
            <EmptyState
              size="sm"
              icon={<MdSearchOff />}
              title={searching ? `No results for "${query.trim()}"` : 'No matching apps'}
              subtitle={searching ? 'Try adjusting your search term' : 'Try different filters'}
            />
          )
        }
      >
        {(apps.length > 5 || attentionCount > 0 || services.length > 1) && toolbar}
        {rows.length > 0 && matrix}
        {/* New orgs start with only the onboarding sample app */}
        {canCreateApps && apps.every((app) => app.name === 'example-app') && (
          <div className="border-t border-neutral-500/10">
            <EmptyState
              size="sm"
              icon={<FaCubes />}
              title="Add your own app"
              subtitle="example-app is a sample to explore. Create an app for each project or service you deploy."
            >
              <Link href={`/${team}/apps?new=true`}>
                <Button variant="primary" icon={FaPlus}>
                  Create an app
                </Button>
              </Link>
            </EmptyState>
          </div>
        )}
      </StableHeight>
    )
  }

  const matrix = (
    <>
      {/* Matrix: md and up */}
      <div ref={setMatrixEl} className="hidden md:block">
        <table className="w-full table-fixed text-left text-xs">
          <colgroup>
            <col />
            {columns.map((column) => (
              <col
                key={column.key}
                style={{ width: column.key === 'OTHER' ? widths?.other : widths?.env }}
              />
            ))}
            <col style={{ width: widths?.access }} />
          </colgroup>
          <thead>
            <tr className="border-b border-neutral-500/20 text-2xs text-neutral-500">
              <th className="px-4 pb-2 font-medium">App</th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  title={column.label}
                  className="truncate px-1.5 pb-2 font-medium"
                >
                  {column.label}
                </th>
              ))}
              <th className="pb-2 pl-2 pr-4 text-right font-medium">Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-500/10">
            {visibleRows.map((app) => {
              const groups = groupEnvironments(app.environments ?? [], columns)
              return (
                <tr key={app.id} className="transition-colors hover:bg-neutral-500/5">
                  <td className="px-4 py-2 align-middle">
                    {/* One row height with or without a description, so filtering keeps the table size */}
                    <div
                      className={clsx(
                        'flex flex-col justify-center',
                        hasDescriptions && 'min-h-11'
                      )}
                    >
                      <Link
                        href={`/${team}/apps/${app.id}`}
                        className="truncate text-xs font-medium text-zinc-900 hover:text-emerald-600 dark:text-zinc-100 dark:hover:text-emerald-400"
                      >
                        {app.name}
                      </Link>
                      {app.description && (
                        <div className="truncate text-2xs text-neutral-500">
                          {descriptionPreview(app.description)}
                        </div>
                      )}
                    </div>
                  </td>
                  {columns.map((column) => (
                    <td key={column.key} className="px-1.5 py-2 align-middle">
                      <EnvCell app={app} envs={groups[column.key]} column={column} team={team} />
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

      {rows.length > PAGE_SIZE && (
        <div className="border-t border-neutral-500/10 px-3 py-2 text-center sm:px-4">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-2xs font-medium text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            {expanded
              ? 'Show fewer'
              : `Show all ${rows.length} ${filtered ? 'matching apps' : 'apps'}`}
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
            <Legend paused={hasPaused} />
            <div className="flex items-center gap-4">
              {services.length > 0 && (
                <PanelLink href={`/${team}/integrations/syncs`}>All syncs</PanelLink>
              )}
              <PanelLink href={`/${team}/apps`}>All apps</PanelLink>
            </div>
          </>
        ) : undefined
      }
    >
      <SyncView.Provider value={view}>{body()}</SyncView.Provider>
    </DashboardPanel>
  )
}
