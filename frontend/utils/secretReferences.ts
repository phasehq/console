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
}

export type OrgApp = {
  id: string
  name: string
  envNames: string[]
  envIds: Record<string, string> // env name (lowercase) → env ID
  envSecretKeys: Record<string, string[]> // env name (lowercase) → ALL decrypted key names
  envRootKeys: Record<string, string[]> // env name (lowercase) → root-level key names only
  folderKeys: Record<string, string[]> // folder path (lowercase, no leading slash) → key names
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
  folderSecretKeys: Record<string, string[]> // folder path (lowercase) → keys at that path
  orgApps: OrgApp[]
  deletedKeys: string[]
}

/** Build a lookup key for secretIdLookup maps. */
export function secretIdKey(envName: string, path: string, keyName: string): string {
  return `${envName.toLowerCase()}|${path}|${keyName}`
}

// --- Regex patterns (matching backend) ---

// Cross-app: ${app::env.path/KEY} — must contain ::
const CROSS_APP_RE = /\$\{(?!\{)(.+?)::(.+?)\.(.+?)\}/g

// Cross-env: ${env.path/KEY} — must contain . but not ::
const CROSS_ENV_RE = /\$\{(?!\{)(?![^{]*::)([^.]+?)\.(.+?)\}/g

// Local: ${KEY} or ${path/KEY} — no . allowed
const LOCAL_REF_RE = /\$\{(?!\{)([^.]+?)\}/g

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
        return { stage: 'cross-app-key', raw, startIndex: dollarIdx, filterText, app, env }
      } else {
        // Has app:: → typing env
        return {
          stage: 'cross-app-env',
          raw,
          startIndex: dollarIdx,
          filterText: afterApp,
          app,
        }
      }
    } else if (dotIdx !== -1) {
      // Has . but no :: → cross-env reference
      const env = raw.slice(0, dotIdx)
      const filterText = raw.slice(dotIdx + 1)
      return { stage: 'cross-env-key', raw, startIndex: dollarIdx, filterText, env }
    } else if (raw.includes('/')) {
      // Has / but no . or :: → folder-qualified reference
      const lastSlash = raw.lastIndexOf('/')
      const folderPath = raw.slice(0, lastSlash)
      const filterText = raw.slice(lastSlash + 1)
      return { stage: 'folder-key', raw, startIndex: dollarIdx, filterText, folderPath }
    } else {
      // No . or :: or / → initial stage (could be local key, env prefix, or app prefix)
      return { stage: 'initial', raw, startIndex: dollarIdx, filterText: raw }
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

export function computeSuggestions(
  token: ActiveReferenceToken,
  context: ReferenceContext,
  currentSecretKey?: string
): ReferenceSuggestion[] {
  const filter = token.filterText.toLowerCase()
  const suggestions: ReferenceSuggestion[] = []

  switch (token.stage) {
    case 'initial': {
      const keySuggestions: ReferenceSuggestion[] = []
      const folderSuggestions: ReferenceSuggestion[] = []
      const envSuggestions: ReferenceSuggestion[] = []
      const appSuggestions: ReferenceSuggestion[] = []

      // Show keys at the current path level (context.secretKeys is already path-filtered by the page query)
      for (const key of context.secretKeys) {
        if (key === currentSecretKey) continue
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
      // Show keys at the specified folder path
      const folderKeys = context.folderSecretKeys[token.folderPath!.toLowerCase()] ?? []
      for (const key of folderKeys) {
        if (context.deletedKeys.includes(key)) continue
        if (key.toLowerCase().includes(filter)) {
          suggestions.push({
            label: key,
            insertText: `${token.folderPath}/${key}`,
            type: 'key',
            description: token.folderPath,
            closesReference: true,
          })
        }
      }

      // Sub-folders under this path
      const prefix = token.folderPath!.toLowerCase() + '/'
      const seenSubFolders = new Set<string>()
      for (const fp of context.folderPaths) {
        if (fp.toLowerCase().startsWith(prefix)) {
          const remaining = fp.slice(prefix.length)
          const nextSlash = remaining.indexOf('/')
          const subFolder = nextSlash === -1 ? remaining : remaining.slice(0, nextSlash)
          if (seenSubFolders.has(subFolder.toLowerCase())) continue
          seenSubFolders.add(subFolder.toLowerCase())
          if (subFolder.toLowerCase().includes(filter)) {
            suggestions.push({
              label: `${subFolder}/`,
              insertText: `${token.folderPath}/${subFolder}/`,
              type: 'folder',
              description: 'Subfolder',
              closesReference: false,
            })
          }
        }
      }
      break
    }

    case 'cross-env-key': {
      const insertPrefix = `${token.env}.`
      const slashIdx = filter.indexOf('/')

      if (slashIdx !== -1) {
        // User is inside a folder, e.g. ${env.backend/...
        const folderPath = token.filterText.slice(0, slashIdx)
        const keyFilter = filter.slice(slashIdx + 1)

        const folderKeys = context.folderSecretKeys[folderPath.toLowerCase()] ?? []
        for (const key of folderKeys) {
          if (context.deletedKeys.includes(key)) continue
          if (key.toLowerCase().includes(keyFilter)) {
            suggestions.push({
              label: key,
              insertText: `${insertPrefix}${folderPath}/${key}`,
              type: 'key',
              description: `${token.env} / ${folderPath}`,
              closesReference: true,
            })
          }
        }

        // Sub-folders
        const subPrefix = folderPath.toLowerCase() + '/'
        const seenSub = new Set<string>()
        for (const fp of context.folderPaths) {
          if (fp.toLowerCase().startsWith(subPrefix)) {
            const rest = fp.slice(subPrefix.length)
            const seg = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest
            if (seenSub.has(seg.toLowerCase())) continue
            seenSub.add(seg.toLowerCase())
            if (seg.toLowerCase().includes(keyFilter)) {
              suggestions.push({
                label: `${seg}/`,
                insertText: `${insertPrefix}${folderPath}/${seg}/`,
                type: 'folder',
                description: 'Subfolder',
                closesReference: false,
              })
            }
          }
        }
      } else {
        // Root level — show folders first, then root-level keys
        for (const folderPath of context.folderPaths) {
          // Only show top-level folders (no slash in the path)
          if (folderPath.includes('/')) continue
          if (folderPath.toLowerCase().includes(filter)) {
            suggestions.push({
              label: `${folderPath}/`,
              insertText: `${insertPrefix}${folderPath}/`,
              type: 'folder',
              description: 'Folder',
              closesReference: false,
            })
          }
        }

        const envKeys = context.envRootKeys[token.env!.toLowerCase()] ?? []
        for (const key of envKeys) {
          if (context.deletedKeys.includes(key)) continue
          if (key.toLowerCase().includes(filter)) {
            suggestions.push({
              label: key,
              insertText: `${insertPrefix}${key}`,
              type: 'key',
              description: token.env,
              closesReference: true,
            })
          }
        }
      }
      break
    }

    case 'cross-app-env': {
      // Show environment names for the specified app
      const app = context.orgApps.find(
        (a) => a.name.toLowerCase() === token.app!.toLowerCase()
      )
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
        const insertPrefix = `${token.app}::${token.env}.`
        const slashIdx = filter.indexOf('/')

        if (slashIdx !== -1) {
          // User is inside a folder, e.g. ${app::env.backend/...
          const folderPath = token.filterText.slice(0, slashIdx)
          const keyFilter = filter.slice(slashIdx + 1)

          const folderKeys = crossApp.folderKeys[folderPath.toLowerCase()] ?? []
          for (const key of folderKeys) {
            if (key.toLowerCase().includes(keyFilter)) {
              suggestions.push({
                label: key,
                insertText: `${insertPrefix}${folderPath}/${key}`,
                type: 'key',
                description: `${token.app} / ${token.env} / ${folderPath}`,
                closesReference: true,
              })
            }
          }

          // Sub-folders from the target app
          const subPrefix = folderPath.toLowerCase() + '/'
          const seenSub = new Set<string>()
          for (const fp of Object.keys(crossApp.folderKeys)) {
            if (fp.startsWith(subPrefix)) {
              const rest = fp.slice(subPrefix.length)
              const seg = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest
              if (seenSub.has(seg)) continue
              seenSub.add(seg)
              if (seg.includes(keyFilter)) {
                suggestions.push({
                  label: `${seg}/`,
                  insertText: `${insertPrefix}${folderPath}/${seg}/`,
                  type: 'folder',
                  description: 'Subfolder',
                  closesReference: false,
                })
              }
            }
          }
        } else {
          // Root level — show folders first, then root-level keys from target app
          const seenFolders = new Set<string>()
          for (const fp of Object.keys(crossApp.folderKeys)) {
            const topLevel = fp.includes('/') ? fp.slice(0, fp.indexOf('/')) : fp
            if (seenFolders.has(topLevel)) continue
            seenFolders.add(topLevel)
            if (topLevel.includes(filter)) {
              suggestions.push({
                label: `${topLevel}/`,
                insertText: `${insertPrefix}${topLevel}/`,
                type: 'folder',
                description: `${token.app} folder`,
                closesReference: false,
              })
            }
          }

          const keys = crossApp.envRootKeys[token.env!.toLowerCase()] ?? []
          for (const key of keys) {
            if (key.toLowerCase().includes(filter)) {
              suggestions.push({
                label: key,
                insertText: `${insertPrefix}${key}`,
                type: 'key',
                description: `${token.app} / ${token.env}`,
                closesReference: true,
              })
            }
          }
        }
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
  // Replace from ${ to cursor with the suggestion's insertText
  const before = fullValue.slice(0, token.startIndex + 2) // everything up to and including ${
  const after = fullValue.slice(token.startIndex + 2 + token.raw.length) // everything after cursor

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
  context: ReferenceContext
): string | null {
  const { teamSlug, appId, envId, envIds } = context

  const buildEnvUrl = (targetAppId: string, targetEnvId: string, folderPath?: string) => {
    const base = `/${teamSlug}/apps/${targetAppId}/environments/${targetEnvId}`
    return folderPath ? `${base}/${folderPath}` : base
  }

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
        const app = context.orgApps.find(
          (a) => a.name.toLowerCase() === token.app!.toLowerCase()
        )
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
        const app = context.orgApps.find(
          (a) => a.name.toLowerCase() === token.app!.toLowerCase()
        )
        if (!app) return null
        targetAppId = app.id
        targetEnvId = app.envIds[token.env.toLowerCase()]
        // insertText is like "app::env.folder/" — extract folder part
        const dotIdx = suggestion.insertText.indexOf('.')
        folderPath = suggestion.insertText.slice(dotIdx + 1).replace(/\/$/, '')
      } else if (token.stage === 'cross-env-key' && token.env) {
        targetEnvId = envIds[token.env.toLowerCase()]
        // insertText is like "env.folder/" — extract folder part
        const dotIdx = suggestion.insertText.indexOf('.')
        folderPath = suggestion.insertText.slice(dotIdx + 1).replace(/\/$/, '')
      } else {
        // Local folder — insertText is like "folder/" or "parent/folder/"
        folderPath = suggestion.insertText.replace(/\/$/, '')
      }

      if (!targetEnvId) return null
      return buildEnvUrl(targetAppId, targetEnvId, folderPath)
    }

    case 'key': {
      // Extract the folder path from the suggestion's insertText
      const extractPathFromInsert = (insertText: string, prefix: string): string => {
        const afterPrefix = prefix ? insertText.slice(prefix.length) : insertText
        const lastSlash = afterPrefix.lastIndexOf('/')
        return lastSlash === -1 ? '/' : '/' + afterPrefix.slice(0, lastSlash)
      }

      if (token.stage === 'cross-app-key' && token.app && token.env) {
        const app = context.orgApps.find(
          (a) => a.name.toLowerCase() === token.app!.toLowerCase()
        )
        if (!app) return null
        const targetEnvId = app.envIds[token.env.toLowerCase()]
        if (!targetEnvId) return null
        const insertPrefix = `${token.app}::${token.env}.`
        const secretPath = extractPathFromInsert(suggestion.insertText, insertPrefix)
        const folderPath = secretPath === '/' ? undefined : secretPath.slice(1)
        const sid = app.secretIdLookup[secretIdKey(token.env, secretPath, suggestion.label)]
        const url = buildEnvUrl(app.id, targetEnvId, folderPath)
        return sid ? `${url}?secret=${sid}` : url
      }
      if (token.stage === 'cross-env-key' && token.env) {
        const targetEnvId = envIds[token.env.toLowerCase()]
        if (!targetEnvId) return null
        const insertPrefix = `${token.env}.`
        const secretPath = extractPathFromInsert(suggestion.insertText, insertPrefix)
        const folderPath = secretPath === '/' ? undefined : secretPath.slice(1)
        const sid = context.secretIdLookup[secretIdKey(token.env, secretPath, suggestion.label)]
        const url = buildEnvUrl(appId, targetEnvId, folderPath)
        return sid ? `${url}?secret=${sid}` : url
      }
      // Local key or folder-key — navigate to current env if available
      if (!envId) return null
      const secretPath = token.stage === 'folder-key' && token.folderPath ? '/' + token.folderPath : '/'
      const folderPath = secretPath === '/' ? undefined : secretPath.slice(1)
      // Determine env name from envId
      const envName = Object.entries(envIds).find(([, id]) => id === envId)?.[0] ?? ''
      const sid = context.secretIdLookup[secretIdKey(envName, secretPath, suggestion.label)]
      const url = buildEnvUrl(appId, envId, folderPath)
      return sid ? `${url}?secret=${sid}` : url
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
  secrets: { key: string; envs: { env: { id?: string; name?: string }; secret: { value: string; stagedForDelete?: boolean } | null }[] }[],
  _environments: { id: string; name: string }[],
  context: ReferenceContext,
  _deletedAppSecretIds: string[]
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
            const { key } = decomposePathAndKey(ref.pathAndKey)
            if (!context.secretKeys.includes(key)) {
              errors.push({
                secretKey: secret.key,
                envName,
                reference: ref.fullMatch,
                error: `Referenced key "${key}" does not exist`,
              })
            } else if (context.deletedKeys.includes(key)) {
              errors.push({
                secretKey: secret.key,
                envName,
                reference: ref.fullMatch,
                error: `Referenced key "${key}" is staged for deletion`,
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
              const { key } = decomposePathAndKey(ref.pathAndKey)
              const targetEnvKeys = context.envSecretKeys[ref.env!.toLowerCase()] ?? []
              if (!targetEnvKeys.includes(key)) {
                errors.push({
                  secretKey: secret.key,
                  envName,
                  reference: ref.fullMatch,
                  error: `Referenced key "${key}" does not exist in "${ref.env}"`,
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
                  const crossAppEnvKeys = crossApp.envSecretKeys[ref.env!.toLowerCase()] ?? []
                  if (crossAppEnvKeys.length > 0 && !crossAppEnvKeys.includes(key)) {
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
