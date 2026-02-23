import { DynamicSecretType, EnvironmentType, SecretType } from '@/apollo/graphql'
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
