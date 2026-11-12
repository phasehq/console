/** A folder in an environment, as returned by the `folders` query */
export type SyncPathFolder = {
  name: string
  /** Path of the folder's parent, e.g. "/" or "/workers" */
  path: string
}

/** A row of the `secretCountsByPath` query */
export type SyncPathSecretCount = {
  path: string
  secretCount: number
}

export type SyncPathOption = {
  /** Full path of the folder, e.g. "/workers/cron" */
  path: string
  /** Last segment of the path, or "/" for the root */
  name: string
  /** Path of the parent folder, or null for the root */
  parentPath: string | null
  depth: number
  /** Folders directly inside this path */
  folderCount: number
  /** Secrets a sync from this path sends */
  secretCount: number
}

/** The number of options listed before the user is asked to type to filter */
export const SYNC_PATH_OPTION_LIMIT = 100

/**
 * Normalises a path exactly like the backend's `normalize_path_string`, which every sync
 * mutation applies before saving the path: repeated slashes are collapsed, a leading slash
 * is added and a trailing one dropped. "workers/" becomes "/workers". Nothing is trimmed,
 * because the backend doesn't trim folder names either: "/svc " and "/svc" are different
 * paths.
 */
export const normalizeSecretPath = (path: string): string => {
  if (path === '/') return path

  let normalized = path
  while (normalized.includes('//')) normalized = normalized.split('//').join('/')
  if (!normalized.startsWith('/')) normalized = `/${normalized}`
  if (normalized.endsWith('/') && normalized !== '/') normalized = normalized.slice(0, -1)
  return normalized
}

/** The path of the secrets in a folder, as the backend builds it from the folder's parent */
export const joinSecretPath = (parent: string, name: string) =>
  normalizeSecretPath(`${parent}/${name}`)

/**
 * Indexes the `secretCountsByPath` rows by path. Paths are kept exactly as stored, since a
 * sync only sends the secrets whose path matches its own exactly.
 */
export const countSecretsByPath = (rows: SyncPathSecretCount[]): Map<string, number> =>
  new Map(rows.map((row) => [row.path, row.secretCount]))

/**
 * Builds the list of paths a sync can read from: the root plus every folder, in tree
 * order. Syncs send only the static secrets stored at exactly the chosen path, not those
 * in subfolders, so each path's count comes from `secretCounts`.
 */
export const buildSyncPathOptions = (
  folders: SyncPathFolder[],
  secretCounts: Map<string, number>
): SyncPathOption[] => {
  const options = new Map<string, SyncPathOption>()
  options.set('/', {
    path: '/',
    name: '/',
    parentPath: null,
    depth: 0,
    folderCount: 0,
    secretCount: secretCounts.get('/') ?? 0,
  })

  folders.forEach((folder) => {
    const parentPath = normalizeSecretPath(folder.path)
    const path = joinSecretPath(parentPath, folder.name)
    if (options.has(path)) return
    options.set(path, {
      path,
      name: folder.name,
      parentPath,
      depth: path.split('/').length - 1,
      folderCount: 0,
      secretCount: secretCounts.get(path) ?? 0,
    })
  })

  // Count each path's subfolders from the list itself, rather than per folder in the API
  options.forEach((option) => {
    const parent = option.parentPath === null ? undefined : options.get(option.parentPath)
    if (parent) parent.folderCount += 1
  })

  // Sort by segment so a folder's children follow it directly
  return Array.from(options.values()).sort((a, b) => {
    const aSegments = a.path.split('/').filter(Boolean)
    const bSegments = b.path.split('/').filter(Boolean)
    for (let i = 0; i < Math.min(aSegments.length, bSegments.length); i++) {
      const order = aSegments[i].localeCompare(bSegments[i])
      if (order !== 0) return order
    }
    return aSegments.length - bSegments.length
  })
}

/**
 * Filters path options by a typed query. With no query every option is listed in tree
 * order. Otherwise matches are ranked: the exact path, then paths that start with the
 * query, then folders whose name starts with it, then any other match.
 *
 * `customPath` is the query as a path when it isn't an existing one. It's listed before
 * the matches, and an existing path that matches exactly is the first match, so the first
 * row is always the path as typed: Enter picks it unless the user moves to another row.
 * The query is trimmed at the ends, as a stray space is almost always a typo.
 */
export const filterSyncPathOptions = (
  options: SyncPathOption[],
  query: string,
  limit = SYNC_PATH_OPTION_LIMIT
): { options: SyncPathOption[]; customPath: string | null; hiddenCount: number } => {
  const trimmed = query.trim()

  if (!trimmed) {
    return {
      options: options.slice(0, limit),
      customPath: null,
      hiddenCount: Math.max(options.length - limit, 0),
    }
  }

  const needle = trimmed.toLowerCase()
  const normalized = normalizeSecretPath(trimmed)
  const normalizedNeedle = normalized.toLowerCase()

  const rank = (option: SyncPathOption) => {
    const path = option.path.toLowerCase()
    if (option.path === normalized) return 0
    if (path.startsWith(normalizedNeedle)) return 1
    if (option.name.toLowerCase().startsWith(needle)) return 2
    if (path.includes(needle)) return 3
    return -1
  }

  const matches = options
    .map((option, index) => ({ option, index, rank: rank(option) }))
    .filter((match) => match.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((match) => match.option)

  const exists = options.some((option) => option.path === normalized)

  return {
    options: matches.slice(0, limit),
    customPath: exists ? null : normalized,
    hiddenCount: Math.max(matches.length - limit, 0),
  }
}

/** Link to an environment's secrets, opened at the given path */
export const environmentPathHref = (team: string, appId: string, envId: string, path: string) => {
  // Segments are used as is, like the environment page's own folder links
  const normalized = normalizeSecretPath(path)
  return `/${team}/apps/${appId}/environments/${envId}${normalized === '/' ? '' : normalized}`
}
