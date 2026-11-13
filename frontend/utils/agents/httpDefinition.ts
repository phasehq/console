/**
 * The definition of a custom HTTP Connection, as the backend stores it.
 *
 * The backend validator (`api/utils/agent_config/http_definition.py`) is the
 * authority; the limits and rules here mirror it so the form can say what is
 * wrong before a round trip. A definition never carries a secret.
 */

export const HTTP_SERVICE_TYPE = 'http'
export const HTTP_SPEC_VERSION = 1

export const HTTP_LIMITS = {
  connectionName: 255,
  hosts: 20,
  fields: 10,
  injections: 10,
  hostName: 253,
  path: 1024,
  identifierValue: 256,
  headerPrefix: 64,
  injectionName: 128,
  fieldName: 32,
  environmentName: 64,
  decoyPrefix: 16,
  secretMinBytes: 8,
  secretMaxBytes: 16384,
} as const

export type HttpHostRule = {
  match: 'exact' | 'suffix'
  value: string
  port?: number
  path?: string
}

export type HttpSecretField = {
  name: string
  kind: 'secret'
  source: { type: 'sealed' }
  env?: string
  decoyPrefix?: string
}

export type HttpIdentifierField = {
  name: string
  kind: 'identifier'
  value: string
  env?: string
}

export type HttpField = HttpSecretField | HttpIdentifierField

export type HttpWhenAbsent = 'attach' | 'block'

export type HttpHeaderInjection = {
  type: 'header'
  name: string
  prefix?: string
  field: string
  whenAbsent?: HttpWhenAbsent
}

export type HttpBasicInjection = {
  type: 'basic'
  usernameField: string
  field: string
  whenAbsent?: HttpWhenAbsent
}

export type HttpQueryInjection = {
  type: 'query'
  name: string
  field: string
  whenAbsent?: HttpWhenAbsent
}

export type HttpInjection = HttpHeaderInjection | HttpBasicInjection | HttpQueryInjection

export type HttpPreset = 'bearer' | 'basic' | 'headers' | 'query'

export type HttpDefinition = {
  specVersion: number
  hosts: HttpHostRule[]
  fields: HttpField[]
  injections: HttpInjection[]
  preset?: HttpPreset
  allowPlainHttp?: boolean
}

export const isCustomConnection = (serviceType?: string | null) =>
  serviceType?.trim().toLowerCase() === HTTP_SERVICE_TYPE

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/**
 * Read a definition that arrived as untyped JSON. Returns null for anything
 * that is not shaped like one, so callers render a fallback instead of
 * throwing on data they did not write.
 */
export const parseHttpDefinition = (value: unknown): HttpDefinition | null => {
  if (!isRecord(value)) return null
  const { hosts, fields, injections } = value
  if (!Array.isArray(hosts) || !Array.isArray(fields) || !Array.isArray(injections)) return null
  const hostsOk = hosts.every(
    (rule) =>
      isRecord(rule) &&
      (rule.match === 'exact' || rule.match === 'suffix') &&
      typeof rule.value === 'string' &&
      (rule.port === undefined || typeof rule.port === 'number') &&
      (rule.path === undefined || typeof rule.path === 'string')
  )
  const fieldsOk = fields.every(
    (field) =>
      isRecord(field) &&
      typeof field.name === 'string' &&
      (field.kind === 'secret' || (field.kind === 'identifier' && typeof field.value === 'string'))
  )
  const injectionsOk = injections.every(
    (injection) =>
      isRecord(injection) &&
      typeof injection.field === 'string' &&
      ((injection.type === 'basic' && typeof injection.usernameField === 'string') ||
        ((injection.type === 'header' || injection.type === 'query') &&
          typeof injection.name === 'string'))
  )
  if (!hostsOk || !fieldsOk || !injectionsOk) return null
  return value as HttpDefinition
}

/**
 * Host rules reduced to what a sealed value binds: match, value and port.
 * Paths are not bound. Deduplicated and sorted by (value, match, port), with
 * an unset port first. Mirrors `reduce_hosts` on the backend.
 */
export const boundHosts = (
  hosts: readonly HttpHostRule[]
): Array<{ match: 'exact' | 'suffix'; value: string; port?: number }> => {
  const reduced = new Map<string, { match: 'exact' | 'suffix'; value: string; port?: number }>()
  for (const rule of hosts) {
    const value = String(rule.value).toLowerCase().replace(/\.+$/, '')
    const port = rule.port ?? null
    const key = JSON.stringify([value, rule.match, port])
    if (reduced.has(key)) continue
    reduced.set(
      key,
      port === null ? { match: rule.match, value } : { match: rule.match, value, port }
    )
  }
  // Plain code-unit order, the same order the backend and the proxy sort in.
  const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)
  return Array.from(reduced.values()).sort(
    (left, right) =>
      compare(left.value, right.value) ||
      compare(left.match, right.match) ||
      (left.port ?? -1) - (right.port ?? -1)
  )
}

export const secretFieldNames = (definition: Pick<HttpDefinition, 'fields'>): string[] =>
  definition.fields.filter((field) => field.kind === 'secret').map((field) => field.name)

/**
 * The free text of a definition that reaches the Agent. A secret must never
 * occur inside any of it: the proxy treats that as a leak.
 */
export const agentVisibleTexts = (
  definition: Pick<HttpDefinition, 'fields' | 'injections'>
): Array<{ label: string; text: string }> => {
  const texts: Array<{ label: string; text: string }> = []
  for (const field of definition.fields) {
    if (field.kind === 'identifier')
      texts.push({ label: `the value of ${field.name}`, text: field.value })
    else if (field.decoyPrefix)
      texts.push({ label: `the decoy prefix of ${field.name}`, text: field.decoyPrefix })
  }
  for (const injection of definition.injections) {
    if (injection.type === 'header' && injection.prefix)
      texts.push({ label: `the prefix of the ${injection.name} header`, text: injection.prefix })
  }
  return texts
}

export const utf8ByteLength = (value: string) => {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit < 0x80) bytes += 1
    else if (unit < 0x800) bytes += 2
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      // A surrogate pair is one four-byte character.
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/

/**
 * Why a secret value would be refused, or '' when it is acceptable. The
 * message never repeats the value.
 */
export const secretValueProblem = (
  value: string,
  definition: Pick<HttpDefinition, 'fields' | 'injections'>
): string => {
  if (value.includes('\u0000') || LONE_SURROGATE.test(value))
    return 'The secret contains characters that cannot be stored.'
  const bytes = utf8ByteLength(value)
  if (bytes < HTTP_LIMITS.secretMinBytes)
    return `The secret must be at least ${HTTP_LIMITS.secretMinBytes} bytes long.`
  if (bytes > HTTP_LIMITS.secretMaxBytes)
    return `The secret must be at most ${HTTP_LIMITS.secretMaxBytes} bytes long.`
  const exposed = agentVisibleTexts(definition).find(({ text }) => text.includes(value))
  if (exposed) return `The secret also appears in ${exposed.label}, which the Agent can read.`
  return ''
}

/** `*.example.com:8443/v1/*`, the way a host rule is typed and shown. */
export const describeHttpHost = (rule: HttpHostRule): string => {
  const bare = rule.match === 'suffix' ? `*${rule.value}` : rule.value
  const host = rule.match === 'exact' && bare.includes(':') ? `[${bare}]` : bare
  return `${host}${rule.port ? `:${rule.port}` : ''}${rule.path ?? ''}`
}

/** One line per injection: where the secret goes in a request. */
export const describeHttpInjection = (
  injection: HttpInjection,
  definition: Pick<HttpDefinition, 'fields'>
): string => {
  const absent = injection.whenAbsent === 'block' ? ' (blocks a request without it)' : ''
  if (injection.type === 'header')
    return `${injection.name}: ${injection.prefix ?? ''}<${injection.field}>${absent}`
  if (injection.type === 'query') return `?${injection.name}=<${injection.field}>${absent}`
  const username = definition.fields.find(
    (field) => field.kind === 'identifier' && field.name === injection.usernameField
  )
  const user = username && username.kind === 'identifier' ? username.value : injection.usernameField
  return `Basic auth as ${user} with <${injection.field}>${absent}`
}

/** A short label for the way a definition authenticates. */
export const httpPresetLabel = (preset?: string | null) => {
  switch (preset) {
    case 'bearer':
      return 'Bearer token'
    case 'basic':
      return 'Basic auth'
    case 'headers':
      return 'Custom headers'
    case 'query':
      return 'Query parameter'
    default:
      return 'Custom'
  }
}

/**
 * What a request through this Connection looks like, as a `curl` line with a
 * placeholder where the proxy puts each secret. Never contains a secret.
 */
export const httpRequestPreview = (definition: HttpDefinition): string => {
  const rule = definition.hosts[0]
  if (!rule) return ''
  const host =
    rule.match === 'suffix'
      ? `api${rule.value}`
      : rule.value.includes(':')
        ? `[${rule.value}]`
        : rule.value
  const path = (rule.path ?? '/').replace(/\*+/g, '…')
  const placeholder = (field: string) => `<${field}>`
  const query = definition.injections
    .filter((injection): injection is HttpQueryInjection => injection.type === 'query')
    .map((injection) => `${injection.name}=${placeholder(injection.field)}`)
  const scheme = definition.allowPlainHttp && rule.port === 80 ? 'http' : 'https'
  const url = `${scheme}://${host}${rule.port ? `:${rule.port}` : ''}${path}${
    query.length ? `${path.includes('?') ? '&' : '?'}${query.join('&')}` : ''
  }`
  const parts = ['curl']
  for (const injection of definition.injections) {
    if (injection.type === 'header')
      parts.push(`-H '${injection.name}: ${injection.prefix ?? ''}${placeholder(injection.field)}'`)
    else if (injection.type === 'basic') {
      const username = definition.fields.find(
        (field) => field.kind === 'identifier' && field.name === injection.usernameField
      )
      const user =
        username && username.kind === 'identifier' ? username.value : injection.usernameField
      parts.push(`-u '${user}:${placeholder(injection.field)}'`)
    }
  }
  parts.push(`'${url}'`)
  return parts.join(' ')
}
