/** A folder in an environment, as returned by the `folders` query */
export type SyncPathFolder = {
  name: string
  /** Path of the folder's parent, e.g. "/" or "/workers" */
  path: string
  folderCount?: number | null
  secretCount?: number | null
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
  /** Secrets a sync from this path sends, or null when unknown */
  secretCount: number | null
}

/** The number of options listed before the user is asked to type to filter */
export const SYNC_PATH_OPTION_LIMIT = 100

/**
 * Normalises a typed path to the form secrets are stored with: a leading slash,
 * no repeated or trailing slashes. "workers/" becomes "/workers".
 */
export const normalizeSecretPath = (path: string): string => {
  const segments = path
    .trim()
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
  return `/${segments.join('/')}`
}

export const joinSecretPath = (parent: string, name: string) =>
  normalizeSecretPath(`${parent}/${name}`)

/**
 * Builds the list of paths a sync can read from: the root plus every folder,
 * in tree order.
 *
 * Syncs send only the static secrets stored at exactly the chosen path (not those
 * in subfolders, and not dynamic secrets), so counts come from `secretPaths`, the
 * path of each static secret in the environment. When that list isn't available
 * (e.g. the user can't read secrets) folders fall back to their own secret count,
 * which also counts dynamic secrets, and the root's count is unknown.
 */
export const buildSyncPathOptions = (
  folders: SyncPathFolder[],
  secretPaths: string[] | null
): SyncPathOption[] => {
  const secretCounts = new Map<string, number>()
  secretPaths?.forEach((path) => {
    const normalized = normalizeSecretPath(path)
    secretCounts.set(normalized, (secretCounts.get(normalized) ?? 0) + 1)
  })

  const options = new Map<string, SyncPathOption>()
  options.set('/', {
    path: '/',
    name: '/',
    parentPath: null,
    depth: 0,
    folderCount: folders.filter((folder) => normalizeSecretPath(folder.path) === '/').length,
    secretCount: secretPaths ? secretCounts.get('/') ?? 0 : null,
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
      folderCount: folder.folderCount ?? 0,
      secretCount: secretPaths ? secretCounts.get(path) ?? 0 : folder.secretCount ?? null,
    })
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
 * Filters path options by a typed query. With no query every option is listed in
 * tree order. Otherwise matches are ranked: the exact path, then paths that start
 * with the query, then folders whose name starts with it, then any other match.
 *
 * `customPath` is the normalised query when it isn't an existing path, so it can be
 * offered as a path of its own.
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
    if (path === normalizedNeedle) return 0
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
