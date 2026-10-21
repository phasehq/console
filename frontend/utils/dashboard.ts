import {
  ApiEnvironmentSyncStatusChoices,
  AppType,
  EnvironmentSyncType,
  EnvironmentType,
  RoleType,
  TeamType,
} from '@/apollo/graphql'

// Org home page helpers. These derive from data already in the Apollo cache
// (GetApps, GetTeams), plus the lean overview queries where noted.

/** A matrix column on the home page: a standard environment, a shared custom name, or Other. */
export interface EnvColumn {
  key: string
  label: string
}

export const STANDARD_ENV_COLUMNS: EnvColumn[] = [
  { key: 'DEV', label: 'Development' },
  { key: 'STAGING', label: 'Staging' },
  { key: 'PROD', label: 'Production' },
]

export const OTHER_ENV_COLUMN: EnvColumn = { key: 'OTHER', label: 'Other' }

const STANDARD_ENV_NAMES: Record<string, string> = {
  development: 'DEV',
  staging: 'STAGING',
  production: 'PROD',
}

/** A custom name needs this many apps, and this share of all apps, to get its own column. */
const MIN_SHARED_APPS = 2
const MIN_SHARED_SHARE = 0.1

const envNameKey = (name?: string | null) => (name ?? '').trim().toLowerCase()

/** Standard environments by type; a custom one named like a standard environment joins its column. */
export const standardColumnKey = (env: Pick<EnvironmentType, 'envType' | 'name'>) => {
  const type = String(env.envType ?? '').toUpperCase()
  if (type === 'DEV' || type === 'STAGING' || type === 'PROD') return type
  return STANDARD_ENV_NAMES[envNameKey(env.name)]
}

const columnKey = (env: Pick<EnvironmentType, 'envType' | 'name'>) =>
  standardColumnKey(env) ?? `name:${envNameKey(env.name)}`

export interface EnvColumnLayout {
  /** Custom names shared widely enough for a column, most shared first. */
  shared: EnvColumn[]
  /** Other is needed while fewer than this many shared columns are shown. */
  otherUnless: number
}

export const envColumnLayout = (apps: AppType[]): EnvColumnLayout => {
  const names = new Map<string, { apps: number; spellings: Map<string, number> }>()
  for (const app of apps) {
    const seen = new Set<string>()
    for (const env of app.environments ?? []) {
      if (!env || standardColumnKey(env)) continue
      const key = envNameKey(env.name)
      const entry = names.get(key) ?? { apps: 0, spellings: new Map() }
      if (!seen.has(key)) entry.apps++
      seen.add(key)
      const spelling = env.name.trim()
      entry.spellings.set(spelling, (entry.spellings.get(spelling) ?? 0) + 1)
      names.set(key, entry)
    }
  }

  const minApps = Math.max(MIN_SHARED_APPS, Math.ceil(apps.length * MIN_SHARED_SHARE))
  const shared = Array.from(names.entries())
    .filter(([key, entry]) => entry.apps >= minApps && key !== 'other')
    .sort(([a, x], [b, y]) => y.apps - x.apps || a.localeCompare(b))
    .map(([key, { spellings }]) => ({
      key: `name:${key}`,
      label: Array.from(spellings.entries()).sort((a, b) => b[1] - a[1])[0][0],
    }))

  const rank = new Map(shared.map((column, i) => [column.key, i]))
  let otherUnless = 0
  for (const key of names.keys())
    otherUnless = Math.max(otherUnless, (rank.get(`name:${key}`) ?? Infinity) + 1)

  return { shared, otherUnless }
}

export const envColumns = (layout: EnvColumnLayout, sharedCount: number): EnvColumn[] => [
  ...STANDARD_ENV_COLUMNS,
  ...layout.shared.slice(0, sharedCount),
  ...(sharedCount < layout.otherUnless ? [OTHER_ENV_COLUMN] : []),
]

/** The most shared columns that fit in `width` px, given the minimum width of each column. */
export const fitSharedColumns = (
  layout: EnvColumnLayout,
  width: number,
  sizes: { app: number; env: number; other: number; access: number; maxShared: number }
) => {
  for (let n = Math.min(layout.shared.length, sizes.maxShared); n > 0; n--) {
    const other = n < layout.otherUnless ? sizes.other : 0
    const needed = sizes.app + sizes.access + other + (STANDARD_ENV_COLUMNS.length + n) * sizes.env
    if (needed <= width) return n
  }
  return 0
}

export const groupEnvironments = (
  environments: Array<EnvironmentType | null | undefined>,
  columns: EnvColumn[]
): Record<string, EnvironmentType[]> => {
  const groups: Record<string, EnvironmentType[]> = {}
  for (const column of columns) groups[column.key] = []
  for (const env of environments) if (env) (groups[columnKey(env)] ?? groups.OTHER)?.push(env)
  return groups
}

export type SyncHealth = 'ok' | 'failing' | 'pending' | 'skipped'

export const syncHealth = (status: ApiEnvironmentSyncStatusChoices | string): SyncHealth => {
  switch (String(status).toUpperCase()) {
    case ApiEnvironmentSyncStatusChoices.Completed:
      return 'ok'
    case ApiEnvironmentSyncStatusChoices.Failed:
    case ApiEnvironmentSyncStatusChoices.TimedOut:
      return 'failing'
    case ApiEnvironmentSyncStatusChoices.Cancelled:
      return 'skipped'
    default:
      return 'pending'
  }
}

export type SyncCounts = Record<SyncHealth, number> & { total: number }

const emptySyncCounts = (): SyncCounts => ({ total: 0, ok: 0, failing: 0, pending: 0, skipped: 0 })

export const countSyncs = (
  syncs: Array<Pick<EnvironmentSyncType, 'status'> | null | undefined>
) => {
  const counts = emptySyncCounts()
  for (const sync of syncs) {
    if (!sync) continue
    counts.total += 1
    counts[syncHealth(sync.status)] += 1
  }
  return counts
}

export const appSyncs = (app: AppType): EnvironmentSyncType[] =>
  (app.environments ?? []).flatMap((env) =>
    (env?.syncs ?? []).filter(Boolean)
  ) as EnvironmentSyncType[]

/** The service a sync writes to, e.g. "github_actions". */
export const syncServiceId = (sync: Pick<EnvironmentSyncType, 'serviceInfo'>) =>
  sync.serviceInfo?.id ?? 'unknown'

export interface OrgSummary {
  apps: number
  environments: number
  appsWithSyncs: number
  syncs: SyncCounts
}

export const summariseApps = (apps: AppType[]): OrgSummary => {
  const allSyncs: EnvironmentSyncType[] = []
  let environments = 0
  let appsWithSyncs = 0

  for (const app of apps) {
    environments += (app.environments ?? []).length
    const syncs = appSyncs(app)
    if (syncs.length) appsWithSyncs += 1
    allSyncs.push(...syncs)
  }

  return { apps: apps.length, environments, appsWithSyncs, syncs: countSyncs(allSyncs) }
}

/** What the sync overview query adds to a cached sync. */
export interface SyncDetail {
  isActive?: boolean | null
  lastSync?: string | null
  options?: unknown
}

export interface ServiceUsage {
  id: string
  name: string
  /** Apps with at least one sync to the service. */
  apps: number
  syncs: number
}

/** The integrations apps sync to, most apps first. */
export const syncServices = (apps: AppType[]): ServiceUsage[] => {
  const services = new Map<string, ServiceUsage & { appIds: Set<string> }>()
  for (const app of apps) {
    for (const sync of appSyncs(app)) {
      const id = syncServiceId(sync)
      const service = services.get(id) ?? {
        id,
        name: sync.serviceInfo?.name ?? id,
        apps: 0,
        syncs: 0,
        appIds: new Set<string>(),
      }
      service.syncs += 1
      service.appIds.add(app.id)
      services.set(id, service)
    }
  }
  return Array.from(services.values())
    .map(({ appIds, ...service }) => ({ ...service, apps: appIds.size }))
    .sort((a, b) => b.apps - a.apps || a.name.localeCompare(b.name))
}

/** One line of plain text from a markdown app description, for previews. */
export const descriptionPreview = (markdown?: string | null): string => {
  const lines = (markdown ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const line = lines.find((l) => !l.startsWith('#')) ?? lines[0] ?? ''
  return line
    .replace(/^#+\s*/, '')
    .replace(/^([-*+>]|\d+\.)\s+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]+/g, '')
    .trim()
}

export type AppSort = 'updated' | 'name' | 'syncs'

export const sortApps = (apps: AppType[], sort: AppSort): AppType[] => {
  const sorted = [...apps]
  if (sort === 'name') return sorted.sort((a, b) => a.name.localeCompare(b.name))
  if (sort === 'syncs')
    return sorted.sort(
      (a, b) => appSyncs(b).length - appSyncs(a).length || a.name.localeCompare(b.name)
    )
  return sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export const appNeedsAttention = (app: AppType) =>
  appSyncs(app).some((sync) => syncHealth(sync.status) === 'failing')

export const filterApps = (
  apps: AppType[],
  query: string,
  attentionOnly = false,
  serviceId: string | null = null
) => {
  const q = query.trim().toLowerCase()
  return apps.filter(
    (app) =>
      (!attentionOnly || appNeedsAttention(app)) &&
      (!serviceId || appSyncs(app).some((sync) => syncServiceId(sync) === serviceId)) &&
      (!q ||
        app.name.toLowerCase().includes(q) ||
        (app.description ?? '').toLowerCase().includes(q))
  )
}

/** Exact name, then name prefix, then name match, then description match; stable within each. */
export const rankByQuery = (apps: AppType[], query: string) => {
  const q = query.trim().toLowerCase()
  if (!q) return apps
  const rank = (app: AppType) => {
    const name = app.name.toLowerCase()
    return name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : 3
  }
  return [...apps].sort((a, b) => rank(a) - rank(b))
}

export interface AccessIndex {
  /** Visible app ids per org member id, via direct membership or a team. */
  members: Map<string, Set<string>>
  /** Visible app ids per service account id, via direct membership or a team. */
  serviceAccounts: Map<string, Set<string>>
  /** The same grants keyed by app id. */
  appMembers: Map<string, Set<string>>
  appServiceAccounts: Map<string, Set<string>>
}

const add = (index: Map<string, Set<string>>, key: string, value: string) => {
  const values = index.get(key) ?? new Set<string>()
  values.add(value)
  index.set(key, values)
}

/** Who can access which apps, from the cached apps and teams queries. */
export const buildAccessIndex = (apps: AppType[], teams: TeamType[] = []): AccessIndex => {
  const index: AccessIndex = {
    members: new Map(),
    serviceAccounts: new Map(),
    appMembers: new Map(),
    appServiceAccounts: new Map(),
  }
  const visibleAppIds = new Set(apps.map((app) => app.id))

  const grantMember = (memberId: string, appId: string) => {
    add(index.members, memberId, appId)
    add(index.appMembers, appId, memberId)
  }
  const grantServiceAccount = (accountId: string, appId: string) => {
    add(index.serviceAccounts, accountId, appId)
    add(index.appServiceAccounts, appId, accountId)
  }

  for (const app of apps) {
    for (const member of app.members ?? []) if (member) grantMember(member.id, app.id)
    for (const account of app.serviceAccounts ?? [])
      if (account) grantServiceAccount(account.id, app.id)
  }

  for (const team of teams) {
    const teamAppIds = (team.apps ?? []).map((app) => app.id).filter((id) => visibleAppIds.has(id))
    for (const membership of team.members ?? []) {
      for (const appId of teamAppIds) {
        if (membership.orgMember) grantMember(membership.orgMember.id, appId)
        else if (membership.serviceAccount) grantServiceAccount(membership.serviceAccount.id, appId)
      }
    }
  }

  return index
}

const MANAGED_ROLE_ORDER = ['owner', 'admin', 'manager', 'developer', 'service']

/** The managed Owner and Admin roles reach every app; custom roles never do. */
export const isGlobalAccessRole = (role?: Pick<RoleType, 'name' | 'isDefault'> | null) =>
  !!role?.isDefault && ['owner', 'admin'].includes((role.name ?? '').toLowerCase())

export interface RoleCount {
  role: RoleType
  count: number
}

/** Accounts per role: managed roles in rank order, then custom roles by size. */
export const roleBreakdown = (accounts: Array<{ role?: RoleType | null }>): RoleCount[] => {
  const counts = new Map<string, RoleCount>()
  for (const { role } of accounts) {
    if (!role) continue
    const entry = counts.get(role.id) ?? { role, count: 0 }
    entry.count += 1
    counts.set(role.id, entry)
  }
  const rank = (role: RoleType) => {
    const index = MANAGED_ROLE_ORDER.indexOf((role.name ?? '').toLowerCase())
    return index === -1 ? MANAGED_ROLE_ORDER.length : index
  }
  return Array.from(counts.values()).sort(
    (a, b) =>
      rank(a.role) - rank(b.role) ||
      b.count - a.count ||
      (a.role.name ?? '').localeCompare(b.role.name ?? '')
  )
}

/** "Created app 'web'" → "created app 'web'", to read on from an actor's name. */
export const asPredicate = (description: string) =>
  /^[A-Z][a-z]/.test(description)
    ? description[0].toLowerCase() + description.slice(1)
    : description

/** Split "Created app 'web'" into plain and quoted parts, to emphasise names. */
export const splitQuoted = (text: string): Array<{ text: string; quoted: boolean }> =>
  text
    .split(/'([^']+)'/)
    .map((part, i) => ({ text: part, quoted: i % 2 === 1 }))
    .filter((part) => part.text !== '')
