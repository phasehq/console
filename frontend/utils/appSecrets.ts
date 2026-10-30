import { EnvironmentType, SecretType } from '@/apollo/graphql'
import { AppSecret } from '@/app/[team]/apps/[app]/types'
import { areTagsAreSame } from '@/utils/tags'

// Client-side flag carried on staged deletions (not part of the GraphQL type)
type SecretWithFlags = SecretType & { stagedForDelete?: boolean }

type EnvEntry = AppSecret['envs'][number]

const entryFor = (row: AppSecret | undefined, envId: string): EnvEntry | undefined =>
  row?.envs.find((entry) => entry.env.id === envId)

/** Field-level equality of two env secrets, including the client-only delete flag */
export const envSecretsEqual = (
  a: SecretWithFlags | null | undefined,
  b: SecretWithFlags | null | undefined
): boolean => {
  if (!a || !b) return !a && !b
  return (
    a.id === b.id &&
    a.key === b.key &&
    a.value === b.value &&
    a.type === b.type &&
    (a.comment ?? '') === (b.comment ?? '') &&
    areTagsAreSame(a.tags ?? [], b.tags ?? []) &&
    (a.stagedForDelete ?? false) === (b.stagedForDelete ?? false)
  )
}

/** True if the client row differs from its server copy in any env (or is new) */
export const appSecretRowIsEdited = (server: AppSecret | undefined, client: AppSecret): boolean => {
  if (!server) return true
  if (server.key !== client.key) return true
  return client.envs.some(
    (entry) => !envSecretsEqual(entryFor(server, entry.env.id!)?.secret, entry.secret)
  )
}

/** Ids of the envs that have undeployed changes */
export const dirtyEnvIds = (server: AppSecret[], client: AppSecret[]): Set<string> => {
  const dirty = new Set<string>()
  const serverById = new Map(server.map((row) => [row.id, row]))
  const clientIds = new Set<string>()

  for (const row of client) {
    clientIds.add(row.id)
    const serverRow = serverById.get(row.id)
    for (const entry of row.envs) {
      const envId = entry.env.id
      if (envId && !envSecretsEqual(entryFor(serverRow, envId)?.secret, entry.secret))
        dirty.add(envId)
    }
  }

  // Server rows dropped from the client copy count against every env they live in
  for (const row of server) {
    if (clientIds.has(row.id)) continue
    for (const entry of row.envs) if (entry.secret && entry.env.id) dirty.add(entry.env.id)
  }

  return dirty
}

/**
 * Rebases unsaved client edits onto a fresh server snapshot: entries the user
 * hasn't touched take the new server copy, edited entries are kept. Rows that
 * only exist in the new snapshot are appended.
 */
export const mergeAppSecretsUpdate = (
  prevServer: AppSecret[],
  prevClient: AppSecret[],
  nextServer: AppSecret[],
  environments: Partial<EnvironmentType>[]
): AppSecret[] => {
  const prevServerById = new Map(prevServer.map((row) => [row.id, row]))
  const nextServerById = new Map(nextServer.map((row) => [row.id, row]))
  const merged: AppSecret[] = []
  const seen = new Set<string>()

  for (const clientRow of prevClient) {
    seen.add(clientRow.id)
    const prevRow = prevServerById.get(clientRow.id)
    const nextRow = nextServerById.get(clientRow.id)
    const edited = appSecretRowIsEdited(prevRow, clientRow)

    if (!edited) {
      // Untouched rows deleted upstream simply disappear
      if (nextRow) merged.push(nextRow)
      continue
    }

    const envs = environments.map((env) => {
      const clientEntry = entryFor(clientRow, env.id!)
      const nextEntry = entryFor(nextRow, env.id!)
      const entryEdited = !envSecretsEqual(
        entryFor(prevRow, env.id!)?.secret,
        clientEntry?.secret
      )
      return {
        env: nextEntry?.env ?? clientEntry?.env ?? env,
        secret: (entryEdited ? clientEntry?.secret : nextEntry?.secret) ?? null,
      }
    })

    const keyEdited = !prevRow || prevRow.key !== clientRow.key
    merged.push({
      ...clientRow,
      key: keyEdited ? clientRow.key : (nextRow?.key ?? clientRow.key),
      envs,
    })
  }

  for (const row of nextServer) if (!seen.has(row.id)) merged.push(row)

  return merged
}

/**
 * Builds one row per (folder path, key) across environments. A key that
 * appears more than once at a path in one env gets extra rows (`<id>#2`, ...)
 * so duplicates stay visible and fixable instead of being silently dropped.
 */
export const buildAppSecretRows = (
  appId: string,
  envSecrets: { env: Partial<EnvironmentType>; secrets: SecretType[] }[]
): AppSecret[] => {
  const rows = new Map<string, AppSecret>()

  envSecrets.forEach(({ env, secrets }, envIndex) => {
    const occurrences = new Map<string, number>()
    for (const secret of secrets) {
      const path = secret.path || '/'
      const slot = `${path}\u0000${secret.key}`
      const n = (occurrences.get(slot) ?? 0) + 1
      occurrences.set(slot, n)
      const base = `${appId}:${path}:${secret.key}`
      const id = n === 1 ? base : `${base}#${n}`

      let row = rows.get(id)
      if (!row) {
        row = {
          id,
          key: secret.key,
          path,
          envs: envSecrets.map((entry) => ({ env: entry.env, secret: null })),
        }
        rows.set(id, row)
      }
      row.envs[envIndex] = { env, secret }
    }
  })

  return Array.from(rows.values())
}

/** One SecretType per env value, carrying its env and its own (possibly renamed) key */
export const flattenAppSecrets = (rows: AppSecret[]): SecretType[] =>
  rows.flatMap((row) =>
    row.envs
      .filter((entry) => entry.secret !== null)
      .map((entry) => ({
        ...entry.secret!,
        key: entry.secret!.key || row.key,
        environment: entry.env as EnvironmentType,
      }))
  )

/** Ids of rows whose key collides with another row's key at the same path in one env */
export const duplicateKeyRowIds = (rows: AppSecret[]): Set<string> => {
  const byEnvKey = new Map<string, string[]>()
  for (const row of rows) {
    for (const entry of row.envs) {
      const secret = entry.secret as SecretWithFlags | null
      if (!secret || secret.stagedForDelete || !entry.env.id) continue
      const key = secret.key || row.key
      if (!key) continue
      const path = secret.path || row.path || '/'
      const slot = `${entry.env.id}\u0000${path}\u0000${key}`
      const ids = byEnvKey.get(slot)
      if (ids) ids.push(row.id)
      else byEnvKey.set(slot, [row.id])
    }
  }

  const duplicates = new Set<string>()
  for (const ids of byEnvKey.values()) if (ids.length > 1) ids.forEach((id) => duplicates.add(id))
  return duplicates
}

export type RowListItem =
  | { kind: 'single'; secret: AppSecret }
  | { kind: 'group'; groupKey: string; rotatingSecretIds: string[]; appSecrets: AppSecret[] }

/**
 * Groups rows that belong to the same rotating secret(s) — connected through a
 * shared rotatingSecretId in any of the given envs — keeping the input order.
 * A group appears where its first member would have.
 */
export const groupRotatingRows = (rows: AppSecret[], envIds: Set<string>): RowListItem[] => {
  type Group = { rowIds: Set<string>; rotatingIds: Set<string> }
  const groupOfRow = new Map<string, Group>()
  const groupOfRotating = new Map<string, Group>()

  for (const row of rows) {
    const rotatingIds = new Set<string>()
    for (const entry of row.envs) {
      const id = envIds.has(entry.env.id!) ? entry.secret?.rotatingSecretId : null
      if (id) rotatingIds.add(id)
    }
    if (rotatingIds.size === 0) continue

    // Union with every group this row touches
    const touched = new Set<Group>()
    for (const id of rotatingIds) {
      const group = groupOfRotating.get(id)
      if (group) touched.add(group)
    }
    const [group = { rowIds: new Set<string>(), rotatingIds: new Set<string>() }, ...others] = [
      ...touched,
    ]
    for (const other of others) {
      for (const id of other.rowIds) {
        group.rowIds.add(id)
        groupOfRow.set(id, group)
      }
      for (const id of other.rotatingIds) {
        group.rotatingIds.add(id)
        groupOfRotating.set(id, group)
      }
    }
    group.rowIds.add(row.id)
    groupOfRow.set(row.id, group)
    for (const id of rotatingIds) {
      group.rotatingIds.add(id)
      groupOfRotating.set(id, group)
    }
  }

  const items: RowListItem[] = []
  const emitted = new Set<string>()
  for (const row of rows) {
    if (emitted.has(row.id)) continue
    const group = groupOfRow.get(row.id)
    if (!group) {
      items.push({ kind: 'single', secret: row })
      emitted.add(row.id)
      continue
    }
    const members = rows.filter((candidate) => group.rowIds.has(candidate.id))
    members.forEach((member) => emitted.add(member.id))
    items.push({
      kind: 'group',
      groupKey: [...group.rotatingIds].sort().join(','),
      rotatingSecretIds: [...group.rotatingIds],
      appSecrets: members,
    })
  }
  return items
}
