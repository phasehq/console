import {
  ApiSecretTypeChoices,
  DynamicSecretType,
  EnvironmentType,
  SecretTagType,
  SecretType,
} from '@/apollo/graphql'
import { AppSecret } from '@/app/[team]/apps/[app]/types'

export type SortOption =
  | 'key'
  | '-key'
  | 'value'
  | '-value'
  | 'created'
  | '-created'
  | 'updated'
  | '-updated'

/**
 * Returns the negative of a supplied boolean value as a string in either lowercase, UPPERCASE or Title Case
 * true <-> false
 * TRUE <-> FALSE
 * True <-> False
 *
 * @param {string} value - A string representation of a boolean value
 * @returns{string} - The boolean negative of the input value
 */
export const toggleBooleanKeepingCase = (value: string): string => {
  // Helper function to determine the case pattern of the input
  const getCasePattern = (str: string) => {
    if (str === str.toLowerCase()) return 'lowercase'
    if (str === str.toUpperCase()) return 'uppercase'
    if (str[0] === str[0].toUpperCase() && str.substring(1) === str.substring(1).toLowerCase())
      return 'titlecase'
    return 'unknown'
  }

  // Determine the input case pattern
  const casePattern = getCasePattern(value)

  // Toggle the value based on the input
  let newValue: string
  if (/^true$/i.test(value)) {
    newValue = 'false'
  } else if (/^false$/i.test(value)) {
    newValue = 'true'
  } else {
    // Return the original value if it's not a match
    return value
  }

  // Apply the case pattern to the new value
  switch (casePattern) {
    case 'lowercase':
      return newValue.toLowerCase()
    case 'uppercase':
      return newValue.toUpperCase()
    case 'titlecase':
      return newValue.charAt(0).toUpperCase() + newValue.slice(1).toLowerCase()
    default:
      // If the case pattern is unknown, return the new value as is
      return newValue
  }
}

export const getSecretPermalink = (secret: SecretType, orgName: string) => {
  return `/${orgName}/apps/${secret.environment.app.id}/environments/${secret.environment.id}${secret.path}?secret=${secret.id}`
}

const SORT_STORAGE_KEY = 'phase-secrets-sort'

const isValidSortOption = (value: string): value is SortOption =>
  ['key', '-key', 'value', '-value', 'created', '-created', 'updated', '-updated'].includes(value)

export const getSavedSort = (): SortOption | null => {
  if (typeof window === 'undefined') return null
  const saved = localStorage.getItem(SORT_STORAGE_KEY)
  return saved && isValidSortOption(saved) ? saved : null
}

export const saveSort = (sort: SortOption) => {
  if (typeof window === 'undefined') return
  localStorage.setItem(SORT_STORAGE_KEY, sort)
}

export const sortSecrets = (secrets: SecretType[], sort: SortOption): SecretType[] => {
  return secrets.slice().sort((a, b) => {
    switch (sort) {
      case 'key':
        return a.key.localeCompare(b.key)
      case '-key':
        return b.key.localeCompare(a.key)
      case 'value':
        return a.key.localeCompare(b.value)
      case '-value':
        return b.key.localeCompare(a.value)
      case 'created':
        return new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime()
      case '-created':
        return new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
      case 'updated':
        return new Date(a.updatedAt!).getTime() - new Date(b.updatedAt!).getTime()
      case '-updated':
        return new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime()
      default:
        return 0
    }
  })
}

/**
 * Sorts AppSecret[] for the cross-env editor.
 * For date-based sorts, uses the earliest createdAt or latest updatedAt across envs.
 */
export const sortAppSecrets = (secrets: AppSecret[], sort: SortOption): AppSecret[] => {
  return secrets.slice().sort((a, b) => {
    switch (sort) {
      case 'key':
        return a.key.localeCompare(b.key)
      case '-key':
        return b.key.localeCompare(a.key)
      case 'value': {
        const aVal = a.envs.find((e) => e.secret)?.secret?.value ?? ''
        const bVal = b.envs.find((e) => e.secret)?.secret?.value ?? ''
        return aVal.localeCompare(bVal)
      }
      case '-value': {
        const aVal = a.envs.find((e) => e.secret)?.secret?.value ?? ''
        const bVal = b.envs.find((e) => e.secret)?.secret?.value ?? ''
        return bVal.localeCompare(aVal)
      }
      case 'created': {
        const aTime = Math.min(
          ...a.envs.filter((e) => e.secret?.createdAt).map((e) => new Date(e.secret!.createdAt!).getTime())
        ) || 0
        const bTime = Math.min(
          ...b.envs.filter((e) => e.secret?.createdAt).map((e) => new Date(e.secret!.createdAt!).getTime())
        ) || 0
        return aTime - bTime
      }
      case '-created': {
        const aTime = Math.min(
          ...a.envs.filter((e) => e.secret?.createdAt).map((e) => new Date(e.secret!.createdAt!).getTime())
        ) || 0
        const bTime = Math.min(
          ...b.envs.filter((e) => e.secret?.createdAt).map((e) => new Date(e.secret!.createdAt!).getTime())
        ) || 0
        return bTime - aTime
      }
      case 'updated': {
        const aTime = Math.max(
          ...a.envs.filter((e) => e.secret?.updatedAt).map((e) => new Date(e.secret!.updatedAt!).getTime())
        ) || 0
        const bTime = Math.max(
          ...b.envs.filter((e) => e.secret?.updatedAt).map((e) => new Date(e.secret!.updatedAt!).getTime())
        ) || 0
        return aTime - bTime
      }
      case '-updated': {
        const aTime = Math.max(
          ...a.envs.filter((e) => e.secret?.updatedAt).map((e) => new Date(e.secret!.updatedAt!).getTime())
        ) || 0
        const bTime = Math.max(
          ...b.envs.filter((e) => e.secret?.updatedAt).map((e) => new Date(e.secret!.updatedAt!).getTime())
        ) || 0
        return bTime - aTime
      }
      default:
        return 0
    }
  })
}

/* ------------------------------------------------------------------ *
 * Secret filtering
 *
 * Two independent, complementary mechanisms narrow the visible list:
 *
 *  - The Filter menu (`SecretFilter`) is a multi-select, OR/union facet:
 *    an item shows if it matches ANY selected toggle.
 *  - The search box (`ParsedSearch`) is a GitHub-style query: every
 *    free-text token AND every qualifier must match (OR only among
 *    repeated values of the same qualifier).
 *
 * The final list is `(menu OR-match) AND (search AND-match)`.
 *
 * Dynamic secrets and folders carry none of a regular secret's
 * attributes (type/tags/override/rotation), so they are gated as whole
 * "kinds" rather than matched per-attribute.
 * ------------------------------------------------------------------ */

// ---- Filter menu (OR / union) ----

export type SecretFilter = {
  types: ApiSecretTypeChoices[]
  rotating: boolean
  dynamic: boolean
  overridden: boolean
  tagIds: string[]
}

export const EMPTY_SECRET_FILTER: SecretFilter = {
  types: [],
  rotating: false,
  dynamic: false,
  overridden: false,
  tagIds: [],
}

export const filterIsActive = (f: SecretFilter): boolean =>
  f.types.length > 0 || f.rotating || f.dynamic || f.overridden || f.tagIds.length > 0

export const activeFilterCount = (f: SecretFilter): number =>
  f.types.length +
  (f.rotating ? 1 : 0) +
  (f.dynamic ? 1 : 0) +
  (f.overridden ? 1 : 0) +
  f.tagIds.length

/** OR/union match for a regular secret. `dynamic` never applies here. */
export const secretMatchesFilter = (secret: SecretType, f: SecretFilter): boolean => {
  if (!filterIsActive(f)) return true
  if (f.types.includes(secret.type)) return true
  if (f.rotating && !!secret.rotatingSecretId) return true
  if (f.overridden && !!secret.override?.isActive) return true
  if (f.tagIds.length > 0 && secret.tags.some((t) => f.tagIds.includes(t.id))) return true
  return false
}

/** An AppSecret matches if ANY of its env secrets matches. */
export const appSecretMatchesFilter = (appSecret: AppSecret, f: SecretFilter): boolean => {
  if (!filterIsActive(f)) return true
  return appSecret.envs.some((e) => e.secret != null && secretMatchesFilter(e.secret, f))
}

/** Dynamic secrets show when the filter is off, or when `dynamic` is selected. */
export const showDynamicUnderFilter = (f: SecretFilter): boolean => !filterIsActive(f) || f.dynamic

/** Distinct tags applied to the given secrets, sorted by name (for the menu). */
export const collectSecretTags = (secrets: SecretType[]): SecretTagType[] => {
  const map = new Map<string, SecretTagType>()
  for (const s of secrets) {
    for (const t of s.tags) if (!map.has(t.id)) map.set(t.id, t)
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
}

export const collectAppSecretTags = (secrets: AppSecret[]): SecretTagType[] => {
  const map = new Map<string, SecretTagType>()
  for (const appSecret of secrets) {
    for (const e of appSecret.envs) {
      for (const t of e.secret?.tags ?? []) if (!map.has(t.id)) map.set(t.id, t)
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
}

// ---- Search box (AND / qualifiers) ----

export type ParsedSearch = {
  text: string[] // free-text tokens, lowercased, all AND'd
  types: ApiSecretTypeChoices[]
  rotating: boolean
  dynamic: boolean
  overridden: boolean
  tagNames: string[] // lowercased, substring-matched against tag names
}

const SECRET_TYPE_BY_NAME: Record<string, ApiSecretTypeChoices> = {
  secret: ApiSecretTypeChoices.Secret,
  sealed: ApiSecretTypeChoices.Sealed,
  config: ApiSecretTypeChoices.Config,
}

const stripQuotes = (s: string): string =>
  s.length >= 2 &&
  ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
    ? s.slice(1, -1)
    : s

/**
 * Parses a search string into free-text tokens and structured qualifiers.
 * Supported qualifiers: `type:secret|sealed|config`, `is:rotating|dynamic|overridden`,
 * `tag:<name>` (quote for spaces, e.g. `tag:"db creds"`). Unrecognized keys or
 * invalid values fall back to free text so a typo never silently empties the list.
 */
export const parseSecretSearch = (query: string): ParsedSearch => {
  const result: ParsedSearch = {
    text: [],
    types: [],
    rotating: false,
    dynamic: false,
    overridden: false,
    tagNames: [],
  }
  // Tokens are whitespace-separated; a `key:` prefix may be followed by a quoted value.
  const rawTokens = query.match(/(\w+:)?("[^"]*"|'[^']*'|\S+)/g) ?? []

  for (const token of rawTokens) {
    const qualifier = token.match(/^([a-zA-Z]+):([\s\S]*)$/)
    if (qualifier) {
      const key = qualifier[1].toLowerCase()
      const value = stripQuotes(qualifier[2]).trim()
      const lower = value.toLowerCase()
      if (key === 'type') {
        const type = SECRET_TYPE_BY_NAME[lower]
        if (type) {
          if (!result.types.includes(type)) result.types.push(type)
          continue
        }
      } else if (key === 'is') {
        if (lower === 'rotating') {
          result.rotating = true
          continue
        }
        if (lower === 'dynamic') {
          result.dynamic = true
          continue
        }
        if (lower === 'overridden' || lower === 'overriden' || lower === 'override') {
          result.overridden = true
          continue
        }
      } else if (key === 'tag') {
        if (lower) {
          if (!result.tagNames.includes(lower)) result.tagNames.push(lower)
          continue
        }
      }
      // Unknown key or invalid value → fall through to free text below.
    }
    const free = stripQuotes(token).trim().toLowerCase()
    if (free) result.text.push(free)
  }
  return result
}

export const searchIsActive = (q: ParsedSearch): boolean =>
  q.text.length > 0 ||
  q.types.length > 0 ||
  q.rotating ||
  q.dynamic ||
  q.overridden ||
  q.tagNames.length > 0

/** Facets that a dynamic secret or folder can never satisfy. */
export const hasRegularOnlyFacet = (q: ParsedSearch): boolean =>
  q.types.length > 0 || q.rotating || q.overridden || q.tagNames.length > 0

/** AND match for a regular secret against a parsed search query. */
export const secretMatchesSearch = (secret: SecretType, q: ParsedSearch): boolean => {
  const key = secret.key.toLowerCase()
  const value = secret.value.toLowerCase()
  for (const token of q.text) {
    if (!key.includes(token) && !value.includes(token)) return false
  }
  if (q.dynamic) return false // a regular secret is never dynamic
  if (q.types.length > 0 && !q.types.includes(secret.type)) return false
  if (q.rotating && !secret.rotatingSecretId) return false
  if (q.overridden && !secret.override?.isActive) return false
  if (q.tagNames.length > 0) {
    const names = secret.tags.map((t) => t.name.toLowerCase())
    if (!q.tagNames.some((n) => names.some((name) => name.includes(n)))) return false
  }
  return true
}

/** An AppSecret matches the search if ANY of its env secrets matches. */
export const appSecretMatchesSearch = (appSecret: AppSecret, q: ParsedSearch): boolean =>
  appSecret.envs.some((e) => e.secret != null && secretMatchesSearch(e.secret, q))

/** Builds the searchable text for a dynamic secret (name + its key names). */
export const dynamicSearchText = (
  name: string,
  keyNames: (string | null | undefined)[] = []
): string => `${name}${keyNames.filter(Boolean).join('')}`.toLowerCase()

/** Dynamic secrets match only free-text tokens, and never a regular-only facet. */
export const dynamicMatchesSearch = (text: string, q: ParsedSearch): boolean => {
  if (hasRegularOnlyFacet(q)) return false
  const hay = text.toLowerCase()
  for (const token of q.text) {
    if (!hay.includes(token)) return false
  }
  return true
}

/**
 * Processes a .env format string into a list of secrets.
 *
 * @param envFileString - the input string
 * @param environment
 * @param path
 * @param withValues - whether to parse values from the file
 * @param withComments - whether to parse comments from the file
 * @returns {SecretType[]}
 */
export const processEnvFile = (
  envFileString: string,
  environment: EnvironmentType,
  path: string,
  withValues: boolean = true,
  withComments: boolean = true
): SecretType[] => {
  const lines = envFileString.split('\n')
  const newSecrets: SecretType[] = []
  let lastComment = ''
  let i = 0

  const findClosingQuote = (str: string, quote: '"' | "'"): number => {
    // first unescaped quote
    for (let idx = 0; idx < str.length; idx++) {
      if (str[idx] === quote && str[idx - 1] !== '\\') return idx
    }
    return -1
  }

  while (i < lines.length) {
    const rawLine = lines[i]
    const trimmed = rawLine.trim()

    // skip blank
    if (!trimmed) {
      i++
      continue
    }

    // full-line comment
    if (trimmed.startsWith('#')) {
      lastComment = trimmed.slice(1).trim()
      i++
      continue
    }

    const eqIdx = rawLine.indexOf('=')
    if (eqIdx === -1) {
      i++
      continue
    }

    const key = rawLine.slice(0, eqIdx).trim()
    if (!key) {
      i++
      continue
    }

    let rest = rawLine.slice(eqIdx + 1).trim()
    let valueStr = ''
    let inlineComment = ''

    // Quoted value (single or double)
    if ((rest.startsWith('"') || rest.startsWith("'")) && rest.length >= 1) {
      const quote = rest[0] as '"' | "'"
      let after = rest.slice(1)

      // try same-line closing quote
      let closeIdx = findClosingQuote(after, quote)
      if (closeIdx >= 0) {
        valueStr = after.slice(0, closeIdx)
        // ignore anything after closing quote (whitespace / # comment)
      } else {
        // multi-line until closing quote is found
        const parts: string[] = [after]
        while (++i < lines.length) {
          const seg = lines[i]
          const segCloseIdx = findClosingQuote(seg, quote)
          if (segCloseIdx >= 0) {
            parts.push(seg.slice(0, segCloseIdx))
            break
          } else {
            parts.push(seg)
          }
        }
        valueStr = parts.join('\n')
        // i now points at the line with the closing quote (or EOF)
      }
      // Unescape escaped quotes and backslashes in double-quoted values
      if (quote === '"') {
        valueStr = valueStr.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      }
    } else {
      // Unquoted: strip inline comment (first #) if present
      const hashIdx = rest.indexOf('#')
      if (hashIdx >= 0) {
        inlineComment = rest.slice(hashIdx + 1).trim()
        rest = rest.slice(0, hashIdx)
      }
      valueStr = rest.trim()
      // If surrounded by quotes (single-line oddities), trim them
      if (
        (valueStr.startsWith('"') && valueStr.endsWith('"')) ||
        (valueStr.startsWith("'") && valueStr.endsWith("'"))
      ) {
        valueStr = valueStr.slice(1, -1)
      }
    }

    newSecrets.push({
      id: `new-${crypto.randomUUID()}`,
      updatedAt: null,
      version: 1,
      key: key.toUpperCase(),
      value: withValues ? valueStr : '',
      tags: [],
      comment: withComments ? lastComment || inlineComment || '' : '',
      path,
      type: ApiSecretTypeChoices.Secret,
      environment,
    })

    lastComment = ''
    i++ // advance to next line
  }

  return newSecrets
}

export const duplicateKeysExist = (
  secrets: SecretType[] | AppSecret[],
  dynamicSecrets: DynamicSecretType[] = []
): boolean => {
  const keySet = new Set<string>()

  // Check regular secrets
  for (const secret of secrets) {
    if (keySet.has(secret.key)) {
      return true // Duplicate found
    }
    keySet.add(secret.key)
  }

  // Check dynamic secrets' keyMap
  for (const ds of dynamicSecrets) {
    if (!ds.keyMap) continue

    for (const km of ds.keyMap) {
      if (!km?.keyName) continue
      if (keySet.has(km.keyName)) {
        return true // Duplicate found
      }
      keySet.add(km.keyName)
    }
  }

  return false // No duplicates
}

/**
 * Formats a secret value for safe inclusion in a .env file.
 * Wraps the value in quotes if it contains characters that would
 * break parsing (e.g. #, newlines, leading quotes, or surrounding whitespace).
 */
export const formatEnvValue = (value: string): string => {
  const needsQuoting =
    value.includes('#') ||
    value.includes('\n') ||
    value.startsWith('"') ||
    value.startsWith("'") ||
    value !== value.trim()

  if (!needsQuoting) return value

  // Prefer double quotes; fall back to single if value contains "
  if (!value.includes('"')) return `"${value}"`
  if (!value.includes("'")) return `'${value}'`
  // Value contains both quote types: escape inner \ and " before wrapping
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}

/**
 * Exports an array of secrets as a downloadable .env file.
 *
 * @param secrets - The secrets to export
 * @param appName - The application name (used in the filename)
 * @param envName - The environment name (used in the filename)
 * @param path - The secret path (used in the filename)
 */
export const exportToEnvFile = (
  secrets: Pick<SecretType, 'key' | 'value' | 'comment'>[],
  appName: string,
  envName: string,
  path: string = '/'
) => {
  const envContent = secrets
    .map((secret) => {
      const comment = secret.comment ? `#${secret.comment}\n` : ''
      return `${comment}${secret.key}=${formatEnvValue(secret.value)}`
    })
    .join('\n')

  const blob = new Blob([envContent], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url

  if (path === '/') {
    a.download = `${appName}.${envName.toLowerCase()}.env`
  } else {
    const formattedPath = path.toLowerCase().replace(/\//g, '.')
    a.download = `${appName}.${envName.toLowerCase()}${formattedPath}.env`
  }

  document.body.appendChild(a)
  a.click()

  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export const envFilePlaceholder = `# Paste your .env here

# Comments before a key-value pair will be parsed
FOO=BAR

API_BASE_URL=https://api.myapp.com # Inline comments will also be parsed

HEALTH_CHECK_URL=$\{API_BASE_URL} # You can also reference secrets`

/**
 * Sorts an array of environment objects by their `index` property in ascending order.
 *
 * This function filters out any `undefined` entries or objects that are missing a numeric `index`,
 * and then returns a sorted array based on the `index` property.
 *
 * @param envs - An array of environment objects, some of which may be `undefined` or partially defined.
 * @returns A sorted array of environment objects with valid `index` values.
 */
export const sortEnvs = (
  envs: Array<Partial<EnvironmentType> | undefined>
): Array<Partial<EnvironmentType>> =>
  envs
    .filter((e): e is Partial<EnvironmentType> => !!e && typeof e.index === 'number')
    .sort((a, b) => a.index! - b.index!)

/**
 * Normalizes a string into a valid environment variable key.
 *
 * This function performs the following operations:
 * 1. Trims whitespace from both ends.
 * 2. Converts the string to uppercase.
 * 3. Replaces spaces and hyphens with underscores.
 * 4. Removes any characters that are not uppercase letters, numbers, or underscores.
 *
 * @param {string} key - The raw key string to normalize.
 * @returns {string} - The normalized key.
 */
export const normalizeKey = (key: string) => {
  return key
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
}
