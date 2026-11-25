import { appSecretsUrl } from '@/utils/appLinks'

// Secret reference parsing, autocomplete suggestions, and validation utilities.
// Matches backend patterns in backend/api/utils/secrets.py

// --- Types ---

export type ReferenceType = 'local' | 'cross-env' | 'cross-app'

export type ParsedReference = {
  type: ReferenceType
  fullMatch: string
  app?: string
  env?: string
  pathAndKey: string // e.g. "KEY" or "backend/KEY"
  startIndex: number
  endIndex: number
}

export type ActiveReferenceToken = {
  stage:
    | 'initial' // just typed ${ — could be local key, env prefix, or app prefix
    | 'folder-key' // typed ${folder/ — now typing key within folder
    | 'cross-env-key' // typed ${env. — now typing key
    | 'cross-app-env' // typed ${app:: — now typing env
    | 'cross-app-key' // typed ${app::env. — now typing key
  raw: string // text between ${ and cursor
  startIndex: number // position of $ in the value
  filterText: string // text to filter suggestions with
  insideClosedRef: boolean // true when cursor is inside a complete ${...} reference
  env?: string
  app?: string
  folderPath?: string // for folder-key stage
}

export type ReferenceSuggestion = {
  label: string
  insertText: string // full text to put between ${ and }
  type: 'key' | 'env' | 'app' | 'folder'
  description?: string
  closesReference: boolean // if true, append } after insertion
}

export type ReferenceValidationError = {
  secretKey: string
  envName: string
  reference: string
  error: string
  /** Set when the referenced key exists but is staged for deletion */
  deleted?: true
}

/** A key at one env and folder, as the editor's own copy has it */
export type KeyState = 'present' | 'deleted' | 'missing'

/** A key and the folder it is in, as stored: `/` or `/backend/config` */
export type KeyAt = { path: string; key: string }

/** The value a reference is typed into: its key, its env and its folder */
export type ReferenceOrigin = { key?: string; envId?: string; path?: string }

export type OrgApp = {
  id: string
  name: string
  envNames: string[]
  envIds: Record<string, string> // env name (lowercase) → env ID
  envSecretKeys: Record<string, string[]> // env name (lowercase) → ALL decrypted key names
  envRootKeys: Record<string, string[]> // env name (lowercase) → root-level key names only
  // Folder paths are kept as named: a reference has to spell a folder the way it is stored
  folderKeys: Record<string, string[]> // folder path (no leading slash) → key names
  envFolderKeys: Record<string, Record<string, string[]>> // env name (lowercase) → { folder path → key names }
  secretIdLookup: Record<string, string> // "env|path|key" → secret ID
}

export type ReferenceContext = {
  teamSlug: string
  appId: string
  envId?: string // current env ID (single-env view only)
  envIds: Record<string, string> // env name (lowercase) → env ID for current app
  secretIdLookup: Record<string, string> // "env|path|key" → secret ID for current app
  secretKeys: string[]
  envSecretKeys: Record<string, string[]> // env name (lowercase) → keys in that env
  envRootKeys: Record<string, string[]> // env name (lowercase) → root-level keys only
  envNames: string[]
  folderPaths: string[]
  folderSecretKeys: Record<string, string[]> // folder path → keys at that path
  envFolderKeys: Record<string, Record<string, string[]>> // env name (lowercase) → { folder path → keys }
  orgApps: OrgApp[]
  deletedKeys: string[]
  /**
   * The keys an env of this app holds in the caller's own copy, each with its folder. What is
   * offered then matches what a deploy checks. Undefined for an env the caller holds no copy of.
   */
  keysOf?: (envId: string) => KeyAt[] | undefined
  /** Looks a key up where a reference points; undefined for an env the caller holds no copy of */
  keyStateAt?: (envId: string | undefined, path: string, key: string) => KeyState | undefined
}

// --- Segment colors (shared by highlight overlay and autocomplete dropdown) ---

export const SEGMENT_COLORS = {
  key: 'text-emerald-700 dark:text-emerald-400',
  env: 'text-cyan-600 dark:text-cyan-400',
  app: 'text-pink-600 dark:text-pink-300',
  folder: 'text-amber-700 dark:text-amber-300',
  delimiter: 'text-slate-500 dark:text-slate-400',
  plain: '',
} as const

/** Build a lookup key for secretIdLookup maps. */
export function secretIdKey(envName: string, path: string, keyName: string): string {
  return `${envName.toLowerCase()}|${path}|${keyName}`
}

// --- Regex patterns (matching backend) ---

// The capture groups exclude `{` and `}` so a single reference can never span
// across an adjacent ${...} reference. Without this, a dot-less local ref placed
// before a dotted ref (e.g. "${LOCAL}-${env.KEY}") makes the dotted pattern's
// leading group greedily consume up to the later dot, producing a bogus match
// (and overlapping refs that double the highlight overlay). Mirrors the backend
// patterns in backend/api/utils/secrets.py.

// Cross-app: ${app::env.path/KEY} — must contain ::
const CROSS_APP_RE = /\$\{(?!\{)([^{}]+?)::([^{}]+?)\.([^{}]+?)\}/g

// Cross-env: ${env.path/KEY} — must contain . but not ::
const CROSS_ENV_RE = /\$\{(?!\{)(?![^{}]*::)([^{}.]+?)\.([^{}]+?)\}/g

// Local: ${KEY} or ${path/KEY} — no . allowed
const LOCAL_REF_RE = /\$\{(?!\{)([^{}.]+?)\}/g

// --- Parsing ---

export function parseAllReferences(value: string): ParsedReference[] {
  const refs: ParsedReference[] = []
  const consumed = new Set<string>() // track consumed ranges to avoid double-matching

  const rangeKey = (s: number, e: number) => `${s}:${e}`

  // Cross-app first (highest specificity)
  for (const m of value.matchAll(CROSS_APP_RE)) {
    const start = m.index!
    const end = start + m[0].length
    consumed.add(rangeKey(start, end))
    refs.push({
      type: 'cross-app',
      fullMatch: m[0],
      app: m[1],
      env: m[2],
      pathAndKey: m[3],
      startIndex: start,
      endIndex: end,
    })
  }

  // Cross-env second
  for (const m of value.matchAll(CROSS_ENV_RE)) {
    const start = m.index!
    const end = start + m[0].length
    if (consumed.has(rangeKey(start, end))) continue
    consumed.add(rangeKey(start, end))
    refs.push({
      type: 'cross-env',
      fullMatch: m[0],
      env: m[1],
      pathAndKey: m[2],
      startIndex: start,
      endIndex: end,
    })
  }

  // Local last
  for (const m of value.matchAll(LOCAL_REF_RE)) {
    const start = m.index!
    const end = start + m[0].length
    if (consumed.has(rangeKey(start, end))) continue
    refs.push({
      type: 'local',
      fullMatch: m[0],
      pathAndKey: m[1],
      startIndex: start,
      endIndex: end,
    })
  }

  return refs.sort((a, b) => a.startIndex - b.startIndex)
}

// --- Active reference detection (for autocomplete) ---

/**
 * Where the reference being typed closes, counted from the cursor, or -1 while it is still open.
 * Only what can be the rest of a reference counts: a `}` further on in a JSON value, past a
 * quote or a space, belongs to something else and must be left alone.
 */
function closingBraceAfter(afterCursor: string): number {
  const at = afterCursor.indexOf('}')
  return at !== -1 && /^[^\s{}$"'`]*$/.test(afterCursor.slice(0, at)) ? at : -1
}

export function getActiveReferenceToken(
  value: string,
  cursorPos: number
): ActiveReferenceToken | null {
  // Scan backward from cursor to find nearest ${ that isn't ${{
  let searchFrom = cursorPos - 1
  while (searchFrom >= 0) {
    const dollarIdx = value.lastIndexOf('${', searchFrom)
    if (dollarIdx === -1) return null

    // Exclude ${{ (Railway syntax)
    if (value[dollarIdx + 2] === '{') {
      searchFrom = dollarIdx - 1
      continue
    }

    // Check there's no } between ${ and cursor (reference already closed)
    const textBetween = value.slice(dollarIdx + 2, cursorPos)
    if (textBetween.includes('}')) {
      searchFrom = dollarIdx - 1
      continue
    }

    const raw = textBetween

    // Check if cursor is inside a closed reference (} after cursor belongs to this ref)
    const insideClosedRef = closingBraceAfter(value.slice(cursorPos)) !== -1

    // Determine stage based on what's been typed
    const doubleColonIdx = raw.indexOf('::')
    const dotIdx = raw.indexOf('.')

    if (doubleColonIdx !== -1) {
      // Has :: → cross-app reference
      const app = raw.slice(0, doubleColonIdx)
      const afterApp = raw.slice(doubleColonIdx + 2)
      const envDotIdx = afterApp.indexOf('.')

      if (envDotIdx !== -1) {
        // Has app::env. → typing key
        const env = afterApp.slice(0, envDotIdx)
        const filterText = afterApp.slice(envDotIdx + 1)
        return { stage: 'cross-app-key', raw, startIndex: dollarIdx, filterText, insideClosedRef, app, env }
      } else {
        // Has app:: → typing env
        return {
          stage: 'cross-app-env',
          raw,
          startIndex: dollarIdx,
          filterText: afterApp,
          insideClosedRef,
          app,
        }
      }
    } else if (dotIdx !== -1) {
      // Has . but no :: → cross-env reference
      const env = raw.slice(0, dotIdx)
      const filterText = raw.slice(dotIdx + 1)
      return { stage: 'cross-env-key', raw, startIndex: dollarIdx, filterText, insideClosedRef, env }
    } else if (raw.includes('/')) {
      // Has / but no . or :: → folder-qualified reference
      const lastSlash = raw.lastIndexOf('/')
      const folderPath = raw.slice(0, lastSlash)
      const filterText = raw.slice(lastSlash + 1)
      return { stage: 'folder-key', raw, startIndex: dollarIdx, filterText, insideClosedRef, folderPath }
    } else {
      // No . or :: or / → initial stage (could be local key, env prefix, or app prefix)
      return { stage: 'initial', raw, startIndex: dollarIdx, filterText: raw, insideClosedRef }
    }
  }

  return null
}

// --- Suggestion computation ---

const MAX_SUGGESTIONS = 30

/**
 * Merges per-category suggestion lists, ensuring each category gets fair representation.
 * Folders appear first, then apps and envs, then keys fill remaining slots.
 */
function mergeSuggestions(
  keys: ReferenceSuggestion[],
  folders: ReferenceSuggestion[],
  envs: ReferenceSuggestion[],
  apps: ReferenceSuggestion[]
): ReferenceSuggestion[] {
  const pinned = [...apps, ...envs, ...folders]
  const remaining = MAX_SUGGESTIONS - pinned.length
  const truncatedKeys = keys.slice(0, Math.max(remaining, 0))
  return [...pinned, ...truncatedKeys]
}

const trimSlashes = (path: string) => path.replace(/^\/+|\/+$/g, '')

/** One env's keys from the org-wide snapshot, in the shape of the caller's own copy */
function keysFromSnapshot(
  rootKeys: string[] | undefined,
  folderKeys: Record<string, string[]> | undefined
): KeyAt[] {
  return [
    ...(rootKeys ?? []).map((key) => ({ path: '/', key })),
    ...Object.entries(folderKeys ?? {}).flatMap(([folder, keys]) =>
      keys.map((key) => ({ path: `/${trimSlashes(folder)}`, key }))
    ),
  ]
}

/**
 * Every folder that holds one of the keys, and the folders that lead to it, without a leading
 * slash. In alphabetical order, as the editor lists them.
 */
function foldersHolding(paths: string[]): string[] {
  const folders = new Set<string>()
  for (const path of paths) {
    const segments = trimSlashes(path).split('/').filter(Boolean)
    segments.forEach((_, depth) => folders.add(segments.slice(0, depth + 1).join('/')))
  }
  const ranked = (name: string) => name.toLowerCase()
  return Array.from(folders).sort((a, b) =>
    ranked(a) === ranked(b) ? (a < b ? -1 : 1) : ranked(a) < ranked(b) ? -1 : 1
  )
}

type Wording = {
  /** Shown beside a key, given the folder it is in ('' at the root) */
  key: (folder: string) => string | undefined
  /** Shown beside a folder at the root */
  rootFolder: string
}

/**
 * What can follow `typed` (a folder path so far, then the start of a name) among one env's keys:
 * the folders at that level, and its keys. A folder is matched in any case but written as it is
 * named, at any depth: a reference resolves only if its path matches the stored one exactly.
 */
function suggestionsWithin(
  keys: KeyAt[],
  typed: string,
  unfiltered: boolean,
  prefix: string,
  wording: Wording,
  emptyFolders: string[] = []
): ReferenceSuggestion[] {
  const lastSlash = typed.lastIndexOf('/')
  // `${/backend/KEY}` is as good as `${backend/KEY}`: the path keeps the form it was started in
  const lead = typed.startsWith('/') ? '/' : ''
  const typedFolder = lastSlash === -1 ? '' : trimSlashes(typed.slice(0, lastSlash))
  const filter = unfiltered ? '' : typed.slice(lastSlash + 1).toLowerCase()
  const folders = foldersHolding([...keys.map((at) => at.path), ...emptyFolders])

  // The folders the typed path can mean: the one spelled that way, else any that differ in case
  const parents =
    typedFolder === '' || folders.includes(typedFolder)
      ? [typedFolder]
      : folders.filter((folder) => folder.toLowerCase() === typedFolder.toLowerCase())

  const keySuggestions: ReferenceSuggestion[] = []
  const folderSuggestions: ReferenceSuggestion[] = []
  const offered = new Set<string>()
  const offer = (list: ReferenceSuggestion[], suggestion: ReferenceSuggestion) => {
    if (offered.has(suggestion.insertText)) return
    offered.add(suggestion.insertText)
    list.push(suggestion)
  }

  for (const parent of parents) {
    const inside = parent === '' ? '' : `${parent}/`
    for (const { path, key } of keys) {
      if (trimSlashes(path) !== parent || !key.toLowerCase().includes(filter)) continue
      offer(keySuggestions, {
        label: key,
        insertText: `${prefix}${lead}${inside}${key}`,
        type: 'key',
        description: wording.key(parent),
        closesReference: true,
      })
    }
    for (const folder of folders) {
      if (!folder.startsWith(inside)) continue
      const name = folder.slice(inside.length).split('/')[0]
      if (!name || !name.toLowerCase().includes(filter)) continue
      offer(folderSuggestions, {
        label: `${name}/`,
        insertText: `${prefix}${lead}${inside}${name}/`,
        type: 'folder',
        description: parent === '' ? wording.rootFolder : 'Subfolder',
        closesReference: false,
      })
    }
  }

  // At the root the folders lead the way; inside a folder its keys do
  return typedFolder === ''
    ? [...folderSuggestions, ...keySuggestions]
    : [...keySuggestions, ...folderSuggestions]
}

export function computeSuggestions(
  token: ActiveReferenceToken,
  context: ReferenceContext,
  origin: ReferenceOrigin = {}
): ReferenceSuggestion[] {
  // Inside a closed reference: show all suggestions (unfiltered) so the user can swap segments
  const unfiltered = token.insideClosedRef
  const filter = unfiltered ? '' : token.filterText.toLowerCase()
  const suggestions: ReferenceSuggestion[] = []

  // A local reference resolves in the value's own env: its keys there, without the value itself
  const originFolder = trimSlashes(origin.path ?? '/')
  const own = origin.envId
    ? context
        .keysOf?.(origin.envId)
        ?.filter((at) => !(at.key === origin.key && trimSlashes(at.path) === originFolder))
    : undefined
  const notDeleted = (at: KeyAt) => !context.deletedKeys.includes(at.key)
  const localWording: Wording = { key: (folder) => folder, rootFolder: 'Folder' }

  switch (token.stage) {
    case 'initial': {
      const keySuggestions: ReferenceSuggestion[] = []
      const folderSuggestions: ReferenceSuggestion[] = []
      const envSuggestions: ReferenceSuggestion[] = []
      const appSuggestions: ReferenceSuggestion[] = []

      if (own) {
        const offered = new Set<string>()
        const offerKey = (insertText: string) => {
          if (offered.has(insertText)) return
          offered.add(insertText)
          keySuggestions.push({ label: insertText, insertText, type: 'key', closesReference: true })
        }
        // A bare key is looked up at the root, wherever the value is. A key beside the value in
        // its folder is therefore offered with that folder
        if (originFolder !== '') {
          for (const { path, key } of own) {
            if (trimSlashes(path) === originFolder && key.toLowerCase().includes(filter))
              offerKey(`${originFolder}/${key}`)
          }
        }
        for (const { path, key } of own) {
          if (trimSlashes(path) === '' && key.toLowerCase().includes(filter)) offerKey(key)
        }

        for (const folderPath of foldersHolding(own.map((at) => at.path))) {
          if (folderPath.toLowerCase().includes(filter)) {
            folderSuggestions.push({
              label: `${folderPath}/`,
              insertText: `${folderPath}/`,
              type: 'folder',
              description: 'Folder',
              closesReference: false,
            })
          }
        }
      } else {
        // No copy to read the value's env from: the keys and folders the caller lists
        for (const key of context.secretKeys) {
          if (key === origin.key) continue
          if (context.deletedKeys.includes(key)) continue
          if (key.toLowerCase().includes(filter)) {
            keySuggestions.push({
              label: key,
              insertText: key,
              type: 'key',
              closesReference: true,
            })
          }
        }

        // Folder-qualified paths
        for (const folderPath of context.folderPaths) {
          if (folderPath.toLowerCase().includes(filter)) {
            folderSuggestions.push({
              label: `${folderPath}/`,
              insertText: `${folderPath}/`,
              type: 'folder',
              description: 'Folder',
              closesReference: false,
            })
          }
        }
      }

      // Environment names (for cross-env refs)
      for (const envName of context.envNames) {
        const prefixed = `${envName}.`
        if (envName.toLowerCase().includes(filter) || prefixed.toLowerCase().startsWith(filter)) {
          envSuggestions.push({
            label: envName,
            insertText: `${envName}.`,
            type: 'env',
            description: 'Environment',
            closesReference: false,
          })
        }
      }

      // App names (for cross-app refs)
      for (const app of context.orgApps) {
        const prefixed = `${app.name}::`
        if (app.name.toLowerCase().includes(filter) || prefixed.toLowerCase().startsWith(filter)) {
          appSuggestions.push({
            label: app.name,
            insertText: `${app.name}::`,
            type: 'app',
            description: 'Application',
            closesReference: false,
          })
        }
      }

      return mergeSuggestions(keySuggestions, folderSuggestions, envSuggestions, appSuggestions)
    }

    case 'folder-key': {
      // The keys at the folder path typed so far, and the folders under it
      suggestions.push(
        ...(own
          ? suggestionsWithin(own, token.raw, unfiltered, '', localWording)
          : suggestionsWithin(
              keysFromSnapshot(undefined, context.folderSecretKeys).filter(notDeleted),
              token.raw,
              unfiltered,
              '',
              localWording,
              context.folderPaths
            ))
      )
      break
    }

    case 'cross-env-key': {
      const envKey = token.env!.toLowerCase()
      const envId = context.envIds[envKey]
      // The target env as the caller's copy has it, else as the org-wide snapshot does
      const keys =
        (envId ? context.keysOf?.(envId) : undefined) ??
        keysFromSnapshot(context.envRootKeys[envKey], context.envFolderKeys[envKey]).filter(
          notDeleted
        )
      suggestions.push(
        ...suggestionsWithin(keys, token.filterText, unfiltered, `${token.env}.`, {
          key: (folder) => (folder ? `${token.env} / ${folder}` : token.env),
          rootFolder: 'Folder',
        })
      )
      break
    }

    case 'cross-app-env': {
      // Show environment names for the specified app
      const app = context.orgApps.find((a) => a.name.toLowerCase() === token.app!.toLowerCase())
      if (app) {
        for (const envName of app.envNames) {
          if (envName.toLowerCase().includes(filter)) {
            suggestions.push({
              label: envName,
              insertText: `${token.app}::${envName}.`,
              type: 'env',
              description: `${token.app} env`,
              closesReference: false,
            })
          }
        }
      }
      break
    }

    case 'cross-app-key': {
      const crossApp = context.orgApps.find(
        (a) => a.name.toLowerCase() === token.app!.toLowerCase()
      )
      if (crossApp) {
        const envKey = token.env!.toLowerCase()
        suggestions.push(
          ...suggestionsWithin(
            keysFromSnapshot(crossApp.envRootKeys[envKey], crossApp.envFolderKeys?.[envKey]),
            token.filterText,
            unfiltered,
            `${token.app}::${token.env}.`,
            {
              key: (folder) =>
                folder ? `${token.app} / ${token.env} / ${folder}` : `${token.app} / ${token.env}`,
              rootFolder: `${token.app} folder`,
            }
          )
        )
      }
      break
    }
  }

  return suggestions.slice(0, MAX_SUGGESTIONS)
}

// --- Insertion ---

export function buildInsertionText(
  suggestion: ReferenceSuggestion,
  token: ActiveReferenceToken,
  fullValue: string
): { newValue: string; newCursorPos: number } {
  const before = fullValue.slice(0, token.startIndex + 2) // everything up to and including ${
  const cursorPos = token.startIndex + 2 + token.raw.length
  const afterCursor = fullValue.slice(cursorPos)

  // Check if cursor is inside a complete (closed) reference
  const closingBraceRelIdx = closingBraceAfter(afterCursor)

  let consumeAfterCursor = 0

  if (closingBraceRelIdx !== -1) {
    // Inside a closed reference — replace the full current segment, not just up to cursor
    const afterCursorInRef = afterCursor.slice(0, closingBraceRelIdx)

    if (suggestion.closesReference) {
      // Key suggestion: replace everything up to and including the closing }
      consumeAfterCursor = closingBraceRelIdx + 1
    } else {
      // Non-key suggestion (env, app, folder): find the matching segment delimiter
      // after the cursor and consume through it. The insertText always ends with
      // the delimiter that separates segments (:: for apps, . for envs, / for folders).
      const insertText = suggestion.insertText
      let delimiterPos = -1
      let delimiterLen = 0

      if (insertText.endsWith('::')) {
        delimiterPos = afterCursorInRef.indexOf('::')
        delimiterLen = 2
      } else if (insertText.endsWith('.')) {
        delimiterPos = afterCursorInRef.indexOf('.')
        delimiterLen = 1
      } else if (insertText.endsWith('/')) {
        delimiterPos = afterCursorInRef.indexOf('/')
        delimiterLen = 1
      }

      if (delimiterPos !== -1) {
        consumeAfterCursor = delimiterPos + delimiterLen
      } else {
        // No matching delimiter found — consume to } inclusive (reference structure changes)
        consumeAfterCursor = closingBraceRelIdx + 1
      }
    }
  }

  const after = fullValue.slice(cursorPos + consumeAfterCursor)
  const closing = suggestion.closesReference ? '}' : ''
  const inserted = suggestion.insertText + closing

  const newValue = before + inserted + after
  const newCursorPos = before.length + inserted.length

  return { newValue, newCursorPos }
}

// --- Navigation ---

/**
 * Builds a URL to navigate to the resource represented by a suggestion.
 * Returns null if a URL cannot be constructed (e.g. missing IDs).
 */
export function getSuggestionUrl(
  suggestion: ReferenceSuggestion,
  token: ActiveReferenceToken,
  context: ReferenceContext,
  origin: ReferenceOrigin = {}
): string | null {
  const { teamSlug, appId, envIds } = context
  // A local suggestion opens in the env of the value it is offered to
  const envId = origin.envId ?? context.envId

  const buildEnvUrl = (
    targetAppId: string,
    targetEnvId: string,
    folderPath?: string,
    secretId?: string
  ) => appSecretsUrl(teamSlug, targetAppId, { envId: targetEnvId, path: folderPath, secretId })

  switch (suggestion.type) {
    case 'app': {
      const app = context.orgApps.find(
        (a) => a.name.toLowerCase() === suggestion.label.toLowerCase()
      )
      if (!app) return null
      return `/${teamSlug}/apps/${app.id}`
    }

    case 'env': {
      if (token.stage === 'cross-app-env' && token.app) {
        // Cross-app env: navigate to the target app's environment
        const app = context.orgApps.find((a) => a.name.toLowerCase() === token.app!.toLowerCase())
        if (!app) return null
        const targetEnvId = app.envIds[suggestion.label.toLowerCase()]
        if (!targetEnvId) return null
        return buildEnvUrl(app.id, targetEnvId)
      }
      // Current app's env
      const targetEnvId = envIds[suggestion.label.toLowerCase()]
      if (!targetEnvId) return null
      return buildEnvUrl(appId, targetEnvId)
    }

    case 'folder': {
      // Extract the folder path from the insertText
      let folderPath: string
      let targetAppId = appId
      let targetEnvId = envId

      if (token.stage === 'cross-app-key' && token.app && token.env) {
        const app = context.orgApps.find((a) => a.name.toLowerCase() === token.app!.toLowerCase())
        if (!app) return null
        targetAppId = app.id
        targetEnvId = app.envIds[token.env.toLowerCase()]
        // insertText is like "app::env.folder/" — extract folder part
        const dotIdx = suggestion.insertText.indexOf('.')
        folderPath = trimSlashes(suggestion.insertText.slice(dotIdx + 1))
      } else if (token.stage === 'cross-env-key' && token.env) {
        targetEnvId = envIds[token.env.toLowerCase()]
        // insertText is like "env.folder/" — extract folder part
        const dotIdx = suggestion.insertText.indexOf('.')
        folderPath = trimSlashes(suggestion.insertText.slice(dotIdx + 1))
      } else {
        // Local folder — insertText is like "folder/" or "parent/folder/"
        folderPath = trimSlashes(suggestion.insertText)
      }

      if (!targetEnvId) return null
      return buildEnvUrl(targetAppId, targetEnvId, folderPath)
    }

    case 'key': {
      // The folder and the key the suggestion's insertText names, past its app and env
      const placeOf = (insertText: string, prefix: string) => {
        const afterPrefix = prefix ? insertText.slice(prefix.length) : insertText
        const lastSlash = afterPrefix.lastIndexOf('/')
        return {
          secretPath: lastSlash === -1 ? '/' : `/${trimSlashes(afterPrefix.slice(0, lastSlash))}`,
          key: afterPrefix.slice(lastSlash + 1),
        }
      }

      if (token.stage === 'cross-app-key' && token.app && token.env) {
        const app = context.orgApps.find((a) => a.name.toLowerCase() === token.app!.toLowerCase())
        if (!app) return null
        const targetEnvId = app.envIds[token.env.toLowerCase()]
        if (!targetEnvId) return null
        const insertPrefix = `${token.app}::${token.env}.`
        const { secretPath, key } = placeOf(suggestion.insertText, insertPrefix)
        const folderPath = secretPath === '/' ? undefined : secretPath.slice(1)
        const sid = app.secretIdLookup[secretIdKey(token.env, secretPath, key)]
        return buildEnvUrl(app.id, targetEnvId, folderPath, sid)
      }
      if (token.stage === 'cross-env-key' && token.env) {
        const targetEnvId = envIds[token.env.toLowerCase()]
        if (!targetEnvId) return null
        const insertPrefix = `${token.env}.`
        const { secretPath, key } = placeOf(suggestion.insertText, insertPrefix)
        const folderPath = secretPath === '/' ? undefined : secretPath.slice(1)
        const sid = context.secretIdLookup[secretIdKey(token.env, secretPath, key)]
        return buildEnvUrl(appId, targetEnvId, folderPath, sid)
      }
      // A local key, at the root or in the folder its insertText names
      if (!envId) return null
      const { secretPath, key } = placeOf(suggestion.insertText, '')
      const folderPath = secretPath === '/' ? undefined : secretPath.slice(1)
      // Determine env name from envId
      const envName = Object.entries(envIds).find(([, id]) => id === envId)?.[0] ?? ''
      const sid = context.secretIdLookup[secretIdKey(envName, secretPath, key)]
      return buildEnvUrl(appId, envId, folderPath, sid)
    }
  }
}

// --- Syntax highlighting ---

export type HighlightSegment = {
  text: string
  type: 'plain' | 'delimiter' | 'app' | 'env' | 'folder' | 'key'
}

/**
 * Segments a secret value into typed parts for syntax highlighting.
 * Each reference (${...}) is split into its constituent parts (app, env, folder, key)
 * with appropriate type annotations for coloring.
 */
export function segmentSecretValue(value: string): HighlightSegment[] {
  const refs = parseAllReferences(value)
  if (refs.length === 0) return [{ text: value, type: 'plain' }]

  const segments: HighlightSegment[] = []
  let lastEnd = 0

  for (const ref of refs) {
    // Plain text before this reference
    if (ref.startIndex > lastEnd) {
      segments.push({ text: value.slice(lastEnd, ref.startIndex), type: 'plain' })
    }

    segments.push({ text: '${', type: 'delimiter' })

    switch (ref.type) {
      case 'cross-app': {
        segments.push({ text: ref.app!, type: 'app' })
        segments.push({ text: '::', type: 'delimiter' })
        segments.push({ text: ref.env!, type: 'env' })
        segments.push({ text: '.', type: 'delimiter' })
        const lastSlash = ref.pathAndKey.lastIndexOf('/')
        if (lastSlash !== -1) {
          segments.push({ text: ref.pathAndKey.slice(0, lastSlash + 1), type: 'folder' })
          segments.push({ text: ref.pathAndKey.slice(lastSlash + 1), type: 'key' })
        } else {
          segments.push({ text: ref.pathAndKey, type: 'key' })
        }
        break
      }
      case 'cross-env': {
        segments.push({ text: ref.env!, type: 'env' })
        segments.push({ text: '.', type: 'delimiter' })
        const lastSlash = ref.pathAndKey.lastIndexOf('/')
        if (lastSlash !== -1) {
          segments.push({ text: ref.pathAndKey.slice(0, lastSlash + 1), type: 'folder' })
          segments.push({ text: ref.pathAndKey.slice(lastSlash + 1), type: 'key' })
        } else {
          segments.push({ text: ref.pathAndKey, type: 'key' })
        }
        break
      }
      case 'local': {
        const lastSlash = ref.pathAndKey.lastIndexOf('/')
        if (lastSlash !== -1) {
          segments.push({ text: ref.pathAndKey.slice(0, lastSlash + 1), type: 'folder' })
          segments.push({ text: ref.pathAndKey.slice(lastSlash + 1), type: 'key' })
        } else {
          segments.push({ text: ref.pathAndKey, type: 'key' })
        }
        break
      }
    }

    segments.push({ text: '}', type: 'delimiter' })
    lastEnd = ref.endIndex
  }

  // Remaining text after last reference
  if (lastEnd < value.length) {
    segments.push({ text: value.slice(lastEnd), type: 'plain' })
  }

  return segments
}

// --- Validation ---

function decomposePathAndKey(pathAndKey: string): { path: string; key: string } {
  const lastSlash = pathAndKey.lastIndexOf('/')
  if (lastSlash === -1) return { path: '/', key: pathAndKey }
  const path = '/' + pathAndKey.slice(0, lastSlash).replace(/^\/+/, '')
  const key = pathAndKey.slice(lastSlash + 1)
  return { path, key }
}

export function validateSecretReferences(
  secrets: {
    key: string
    envs: {
      env: { id?: string; name?: string }
      secret: { value: string; stagedForDelete?: boolean } | null
    }[]
  }[],
  context: ReferenceContext
): ReferenceValidationError[] {
  const errors: ReferenceValidationError[] = []

  const envNameSet = new Set(context.envNames.map((n) => n.toLowerCase()))
  const orgAppNameSet = new Set(context.orgApps.map((a) => a.name.toLowerCase()))

  for (const secret of secrets) {
    for (const envEntry of secret.envs) {
      if (!envEntry.secret || envEntry.secret.stagedForDelete) continue
      const value = envEntry.secret.value
      if (!value) continue

      const refs = parseAllReferences(value)
      for (const ref of refs) {
        const envName = envEntry.env.name ?? 'unknown'

        switch (ref.type) {
          case 'local': {
            const { path, key } = decomposePathAndKey(ref.pathAndKey)
            // Resolved at the folder the reference names (the root if none), in the value's own env
            const state: KeyState =
              context.keyStateAt?.(envEntry.env.id, path, key) ??
              (!context.secretKeys.includes(key)
                ? 'missing'
                : context.deletedKeys.includes(key)
                  ? 'deleted'
                  : 'present')
            if (state === 'missing') {
              errors.push({
                secretKey: secret.key,
                envName,
                reference: ref.fullMatch,
                error: `Referenced key "${key}" does not exist`,
              })
            } else if (state === 'deleted') {
              errors.push({
                secretKey: secret.key,
                envName,
                reference: ref.fullMatch,
                error: `Referenced key "${key}" is staged for deletion`,
                deleted: true,
              })
            }
            break
          }

          case 'cross-env': {
            if (!envNameSet.has(ref.env!.toLowerCase())) {
              errors.push({
                secretKey: secret.key,
                envName,
                reference: ref.fullMatch,
                error: `Referenced environment "${ref.env}" does not exist`,
              })
            } else {
              const { path, key } = decomposePathAndKey(ref.pathAndKey)
              const targetEnv = ref.env!.toLowerCase()
              const state = context.keyStateAt?.(context.envIds[targetEnv], path, key)
              const targetEnvKeys = context.envSecretKeys[targetEnv] ?? []
              if (state ? state === 'missing' : !targetEnvKeys.includes(key)) {
                errors.push({
                  secretKey: secret.key,
                  envName,
                  reference: ref.fullMatch,
                  error: `Referenced key "${key}" does not exist in "${ref.env}"`,
                })
              } else if (state === 'deleted') {
                errors.push({
                  secretKey: secret.key,
                  envName,
                  reference: ref.fullMatch,
                  error: `Referenced key "${key}" is staged for deletion in "${ref.env}"`,
                  deleted: true,
                })
              }
            }
            break
          }

          case 'cross-app': {
            if (!orgAppNameSet.has(ref.app!.toLowerCase())) {
              errors.push({
                secretKey: secret.key,
                envName,
                reference: ref.fullMatch,
                error: `Referenced app "${ref.app}" does not exist in this organisation`,
              })
            } else {
              const crossApp = context.orgApps.find(
                (a) => a.name.toLowerCase() === ref.app!.toLowerCase()
              )
              if (crossApp) {
                const crossAppEnvNames = crossApp.envNames.map((n) => n.toLowerCase())
                if (!crossAppEnvNames.includes(ref.env!.toLowerCase())) {
                  errors.push({
                    secretKey: secret.key,
                    envName,
                    reference: ref.fullMatch,
                    error: `Referenced environment "${ref.env}" does not exist in app "${ref.app}"`,
                  })
                } else {
                  const { key } = decomposePathAndKey(ref.pathAndKey)
                  const crossAppEnvKeys = crossApp.envSecretKeys[ref.env!.toLowerCase()]
                  // undefined = no decrypt access, skip; defined (incl. []) = strict check
                  if (crossAppEnvKeys !== undefined && !crossAppEnvKeys.includes(key)) {
                    errors.push({
                      secretKey: secret.key,
                      envName,
                      reference: ref.fullMatch,
                      error: `Referenced key "${key}" does not exist in "${ref.app}" / "${ref.env}"`,
                    })
                  }
                }
              }
            }
            break
          }
        }
      }
    }
  }

  return errors
}
