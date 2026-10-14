import {
  ApiEnvironmentSyncStatusChoices,
  AppType,
  EnvironmentSyncType,
  EnvironmentType,
  RoleType,
  TeamType,
} from '@/apollo/graphql'

// Org home page helpers. Everything here derives from data already in the
// Apollo cache (GetApps, GetTeams), so the page adds no backend work.

/** Matrix columns on the home page. Custom environments share the last one. */
export type EnvColumn = 'DEV' | 'STAGING' | 'PROD' | 'OTHER'

export const ENV_COLUMN_LABELS: Record<EnvColumn, string> = {
  DEV: 'Development',
  STAGING: 'Staging',
  PROD: 'Production',
  OTHER: 'Other',
}

export const envColumn = (env: Pick<EnvironmentType, 'envType'>): EnvColumn => {
  const type = String(env.envType ?? '').toUpperCase()
  return type === 'DEV' || type === 'STAGING' || type === 'PROD' ? type : 'OTHER'
}

export const groupEnvironments = (
  environments: Array<EnvironmentType | null | undefined>
): Record<EnvColumn, EnvironmentType[]> => {
  const groups: Record<EnvColumn, EnvironmentType[]> = { DEV: [], STAGING: [], PROD: [], OTHER: [] }
  for (const env of environments) if (env) groups[envColumn(env)].push(env)
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

export interface ServiceSummary {
  id: string
  name: string
  providerId: string
  syncs: SyncCounts
  appIds: string[]
}

export interface OrgSummary {
  apps: number
  environments: number
  appsWithSyncs: number
  syncs: SyncCounts
  /** Third-party services in use, most syncs first. */
  services: ServiceSummary[]
}

export const summariseApps = (apps: AppType[]): OrgSummary => {
  const services = new Map<string, ServiceSummary & { appIdSet: Set<string> }>()
  const allSyncs: EnvironmentSyncType[] = []
  let environments = 0
  let appsWithSyncs = 0

  for (const app of apps) {
    environments += (app.environments ?? []).length
    const syncs = appSyncs(app)
    if (syncs.length) appsWithSyncs += 1
    for (const sync of syncs) {
      allSyncs.push(sync)
      const service = sync.serviceInfo
      const id = service?.id ?? 'unknown'
      let entry = services.get(id)
      if (!entry) {
        entry = {
          id,
          name: service?.name ?? id,
          providerId: service?.provider?.id ?? id,
          syncs: emptySyncCounts(),
          appIds: [],
          appIdSet: new Set(),
        }
        services.set(id, entry)
      }
      entry.syncs.total += 1
      entry.syncs[syncHealth(sync.status)] += 1
      entry.appIdSet.add(app.id)
    }
  }

  return {
    apps: apps.length,
    environments,
    appsWithSyncs,
    syncs: countSyncs(allSyncs),
    services: Array.from(services.values())
      .map(({ appIdSet, ...service }) => ({ ...service, appIds: Array.from(appIdSet) }))
      .sort((a, b) => b.syncs.total - a.syncs.total || a.name.localeCompare(b.name)),
  }
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

export const filterApps = (apps: AppType[], query: string, attentionOnly = false) => {
  const q = query.trim().toLowerCase()
  return apps.filter(
    (app) =>
      (!attentionOnly || appNeedsAttention(app)) &&
      (!q ||
        app.name.toLowerCase().includes(q) ||
        (app.description ?? '').toLowerCase().includes(q))
  )
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
