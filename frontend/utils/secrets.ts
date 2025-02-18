import { EnvironmentType, SecretType } from '@/apollo/graphql'

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

  lines.forEach((line) => {
    let trimmed = line.trim()
    if (!trimmed) return // Skip empty lines

    if (trimmed.startsWith('#')) {
      lastComment = trimmed.slice(1).trim()
      return
    }

    const [key, ...valueParts] = trimmed.split('=')
    if (!key) return // Skip malformed lines

    let valueWithComment = valueParts.join('=')
    let [parsedValue, inlineComment] = valueWithComment.split('#').map((part) => part.trim())

    let value = withValues ? parsedValue.replace(/^['"]|['"]$/g, '') : ''

    newSecrets.push({
      id: `new-${crypto.randomUUID()}`,
      updatedAt: null,
      version: 1,
      key: key.trim().toUpperCase(),
      value,
      tags: [],
      comment: withComments ? lastComment || inlineComment || '' : '',
      path,
      environment,
    })
    lastComment = '' // Reset lastComment after assigning it
  })

  return newSecrets
}

export const envFilePlaceholder = `# Paste your .env here

# Comments before a key-value pair will be parsed
FOO=BAR

API_BASE_URL=https://api.myapp.com # Inline comments will also be parsed

HEALTH_CHECK_URL=$\{API_BASE_URL} # You can also reference secrets`
