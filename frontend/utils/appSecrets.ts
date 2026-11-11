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

type ServerIndex = {
  rows: Map<string, AppSecret>
  secrets: Map<string, SecretType>
  /** The row each server secret is in */
  rowIdOf: Map<string, string>
}

// Kept per snapshot: aligning runs on every keystroke
const serverIndexes = new WeakMap<AppSecret[], ServerIndex>()

const serverIndex = (server: AppSecret[]): ServerIndex => {
  let index = serverIndexes.get(server)
  if (!index) {
    index = { rows: new Map(), secrets: new Map(), rowIdOf: new Map() }
    for (const row of server) {
      index.rows.set(row.id, row)
      for (const { secret } of row.envs) {
        if (!secret) continue
        index.secrets.set(secret.id, secret)
        index.rowIdOf.set(secret.id, row.id)
      }
    }
    serverIndexes.set(server, index)
  }
  return index
}

/** Server copies follow their values to the client row holding them, as when a discarded rename splits a key */
export const alignServerRows = (server: AppSecret[], client: AppSecret[]): AppSecret[] => {
  if (client === server) return server
  const { rows, rowIdOf } = serverIndex(server)

  const movedTo = new Map<string, string>()
  for (const row of client) {
    if (rows.get(row.id) === row) continue
    for (const { secret } of row.envs) {
      const home = secret && rowIdOf.get(secret.id)
      if (home && home !== row.id) movedTo.set(secret!.id, row.id)
    }
  }
  if (movedTo.size === 0) return server

  const regrouped = new Set(movedTo.values())
  for (const secretId of movedTo.keys()) regrouped.add(rowIdOf.get(secretId)!)

  const aligned: AppSecret[] = []
  const rebuilt = new Map<string, AppSecret>()
  for (const row of server) {
    if (!regrouped.has(row.id)) {
      aligned.push(row)
      continue
    }
    for (const entry of row.envs) {
      if (!entry.secret) continue
      const id = movedTo.get(entry.secret.id) ?? row.id
      let target = rebuilt.get(id)
      if (!target) {
        target = { ...row, id, envs: row.envs.map(({ env }) => ({ env, secret: null })) }
        rebuilt.set(id, target)
        aligned.push(target)
      }
      target.envs = target.envs.map((slot) => (slot.env.id === entry.env.id ? entry : slot))
    }
  }
  return aligned
}

type NewRowId = () => string
const randomRowId: NewRowId = () => crypto.randomUUID()

const rowPath = (row: AppSecret) => row.path ?? '/'

const withSecret = (row: AppSecret, envId: string, secret: SecretType | null): AppSecret => ({
  ...row,
  envs: row.envs.map((entry) => (entry.env.id === envId ? { ...entry, secret } : entry)),
})

/** Moves values whose key isn't their row's to a row of that key, so no row mixes two keys */
const settleRowKeys = (
  rows: AppSecret[],
  rowIds: Iterable<string>,
  server: ServerIndex,
  newRowId: NewRowId
) => {
  const settled = rows.slice()
  const touched = new Set<string>()
  const serverKeyOf = (secret: SecretType | null) =>
    secret ? server.secrets.get(secret.id)?.key : undefined

  for (const id of rowIds) {
    const at = settled.findIndex((row) => row.id === id)
    const source = settled[at]
    const strays = source?.envs.filter(({ secret }) => secret && secret.key !== source.key) ?? []
    if (strays.length === 0) continue
    touched.add(source.id)

    const sameSpot = (row: AppSecret, key: string) =>
      row.id !== source.id && row.key === key && rowPath(row) === rowPath(source)
    const key = strays[0].secret!.key
    const allLeave =
      strays.length === source.envs.filter((entry) => entry.secret).length &&
      strays.every(({ secret }) => secret!.key === key)
    // Nothing keeps the row's key and no other row has theirs: the row itself takes it
    if (allLeave && !settled.some((row) => sameSpot(row, key))) {
      settled[at] = { ...source, key }
      continue
    }

    settled[at] = {
      ...source,
      envs: source.envs.map((entry) => (strays.includes(entry) ? { ...entry, secret: null } : entry)),
    }
    for (const { env, secret } of strays) {
      const serverKey = serverKeyOf(secret)
      let to = settled.findIndex(
        (row) =>
          sameSpot(row, secret!.key) &&
          !entryFor(row, env.id!)?.secret &&
          // One server key per row, so its server copy has a single key to compare with
          row.envs.every((other) => {
            const otherKey = serverKeyOf(other.secret)
            return !otherKey || !serverKey || otherKey === serverKey
          })
      )
      if (to === -1) {
        to = settled.findIndex((row) => row.id === source.id) + 1
        settled.splice(to, 0, {
          id: newRowId(),
          key: secret!.key,
          path: source.path,
          envs: source.envs.map((entry) => ({ env: entry.env, secret: null })),
        })
      }
      settled[to] = withSecret(settled[to], env.id!, secret)
      touched.add(settled[to].id)
    }
  }
  return { rows: settled, touched }
}

/** Drops rows a change left empty, and hands a row its server copy back once nothing in it differs */
const tidyRows = (rows: AppSecret[], touched: ReadonlySet<string>, server: ServerIndex) => {
  const kept = rows.filter((row) => !touched.has(row.id) || row.envs.some((entry) => entry.secret))
  return kept.map((row) => {
    if (!touched.has(row.id)) return row
    const held = row.envs.find(({ secret }) => secret && server.rowIdOf.has(secret.id))?.secret
    const serverRow = held && server.rows.get(server.rowIdOf.get(held.id)!)
    const pristine =
      serverRow &&
      serverRow.key === row.key &&
      serverRow.envs.length === row.envs.length &&
      serverRow.envs.every((entry) =>
        envSecretsEqual(entry.secret, entryFor(row, entry.env.id!)?.secret)
      ) &&
      !kept.some((other) => other !== row && other.id === serverRow.id)
    return pristine ? serverRow : row
  })
}

const staleIn =
  (aligned: ReadonlyMap<string, AppSecret>, row: AppSecret, match: (entry: EnvEntry) => boolean) =>
  (entry: EnvEntry) =>
    match(entry) &&
    !envSecretsEqual(entryFor(aligned.get(row.id), entry.env.id!)?.secret, entry.secret)

const alignedById = (server: AppSecret[], client: AppSecret[]) =>
  new Map(alignServerRows(server, client).map((row) => [row.id, row]))

/** Puts matching env values back as deployed; a rename put back in only some envs splits its key in two */
export const revertAppSecretEntries = (
  client: AppSecret[],
  server: AppSecret[],
  match: (entry: EnvEntry) => boolean,
  newRowId: NewRowId = randomRowId
): AppSecret[] => {
  const aligned = alignedById(server, client)
  const touched = new Set<string>()
  const rekeyed = new Set<string>()

  const reverted = client.map((row) => {
    const stale = staleIn(aligned, row, match)
    if (!row.envs.some(stale)) return row
    touched.add(row.id)
    return {
      ...row,
      envs: row.envs.map((entry) => {
        if (!stale(entry)) return entry
        const secret = entryFor(aligned.get(row.id), entry.env.id!)?.secret ?? null
        if (secret && secret.key !== row.key) rekeyed.add(row.id)
        return { ...entry, secret }
      }),
    }
  })

  const index = serverIndex(server)
  const settled = settleRowKeys(reverted, rekeyed, index, newRowId)
  return tidyRows(settled.rows, new Set([...touched, ...settled.touched]), index)
}

/** A value as it was before a discard, and where its row sat */
export type DiscardedEntry = { row: AppSecret; index: number; envId: string }

/** What a discard is about to put back, kept so it can be undone */
export const staleAppSecretEntries = (
  client: AppSecret[],
  server: AppSecret[],
  match: (entry: EnvEntry) => boolean
): DiscardedEntry[] => {
  const aligned = alignedById(server, client)
  return client.flatMap((row, index) =>
    row.envs
      .filter(staleIn(aligned, row, match))
      .map((entry) => ({ row, index, envId: entry.env.id! }))
  )
}

/** Undoes a discard: each value comes back as it was, in the row of its key */
export const restoreAppSecretEntries = (
  client: AppSecret[],
  server: AppSecret[],
  discarded: DiscardedEntry[],
  newRowId: NewRowId = randomRowId
): AppSecret[] => {
  const rows = client.slice()
  const touched = new Set<string>()

  for (const { row: before, index: wasAt, envId } of discarded) {
    const secret = entryFor(before, envId)?.secret
    if (!secret) continue
    // Its deployed copy, wherever the discard left it; a new value was dropped, maybe with its row
    let to = rows.findIndex((row) => entryFor(row, envId)?.secret?.id === secret.id)
    if (to === -1)
      to = rows.findIndex((row) => row.id === before.id && !entryFor(row, envId)?.secret)
    if (to === -1) {
      to = Math.min(wasAt, rows.length)
      rows.splice(to, 0, {
        ...before,
        id: rows.some((row) => row.id === before.id) ? newRowId() : before.id,
        envs: before.envs.map((entry) => ({ env: entry.env, secret: null })),
      })
    }
    rows[to] = withSecret(rows[to], envId, secret)
    touched.add(rows[to].id)
  }

  const index = serverIndex(server)
  const settled = settleRowKeys(rows, touched, index, newRowId)
  return tidyRows(settled.rows, new Set([...touched, ...settled.touched]), index)
}

/** What a deploy sent, kept until a snapshot shows it */
export type DeployedChanges = {
  createdIds: string[]
  deletedIds: string[]
  /** Each edited secret's updatedAt from before the deploy */
  editedAt: ReadonlyMap<string, string | null | undefined>
}

/** Whether a snapshot was read after the deploy: an older one can be published again while the fresh one loads */
export const snapshotHasDeploy = (snapshot: AppSecret[], deployed: DeployedChanges): boolean => {
  const secrets = new Map<string, SecretType>()
  for (const row of snapshot)
    for (const { secret } of row.envs) if (secret) secrets.set(secret.id, secret)
  if (!deployed.createdIds.every((id) => secrets.has(id))) return false
  if (deployed.deletedIds.some((id) => secrets.has(id))) return false
  for (const [id, before] of deployed.editedAt) {
    const secret = secrets.get(id)
    if (secret && before != null && secret.updatedAt === before) return false
  }
  return true
}

/** React keys for a deployed snapshot's rows: each takes over from the client row it replaces, keeping its DOM */
export const carryRowKeys = (
  before: AppSecret[],
  after: AppSecret[],
  keyOf: (rowId: string) => string
): Map<string, string> => {
  const spot = (row: AppSecret) => `${rowPath(row)}\n${row.key}`
  const previous = new Map(before.map((row) => [spot(row), keyOf(row.id)]))
  const carried = new Map<string, string>()
  const taken = new Set<string>()
  for (const row of after) {
    const key = previous.get(spot(row)) ?? row.id
    // Two rows after one key: let them all remount rather than share it
    if (taken.has(key)) return new Map()
    taken.add(key)
    if (key !== row.id) carried.set(row.id, key)
  }
  return carried
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
/** A key a dynamic secret maps in one env and folder */
export type DynamicKeySlot = { envId: string; path: string; key: string }

const keySlot = (envId: string, path: string, key: string) => `${envId}\u0000${path}\u0000${key}`

/** Dynamic secrets' key names count too: they share the env's namespace */
export const duplicateKeyRowIds = (
  rows: AppSecret[],
  dynamicKeys: DynamicKeySlot[] = []
): Set<string> => {
  const dynamicSlots = new Set(dynamicKeys.map(({ envId, path, key }) => keySlot(envId, path, key)))
  const byEnvKey = new Map<string, string[]>()
  for (const row of rows) {
    for (const entry of row.envs) {
      const secret = entry.secret as SecretWithFlags | null
      if (!secret || secret.stagedForDelete || !entry.env.id) continue
      const key = secret.key || row.key
      if (!key) continue
      const slot = keySlot(entry.env.id, secret.path || row.path || '/', key)
      const ids = byEnvKey.get(slot)
      if (ids) ids.push(row.id)
      else byEnvKey.set(slot, [row.id])
    }
  }

  const duplicates = new Set<string>()
  for (const [slot, ids] of byEnvKey)
    if (ids.length > 1 || dynamicSlots.has(slot)) ids.forEach((id) => duplicates.add(id))
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
