/**
 * The custom Connection form: its state, and its conversion to and from a definition.
 * A definition it cannot express reads back as null and is shown read-only.
 */

import isEqual from 'lodash/isEqual'
import * as ipaddr from 'ipaddr.js'
import {
  HTTP_LIMITS,
  HTTP_SPEC_VERSION,
  type HttpDefinition,
  type HttpField,
  type HttpHostRule,
  type HttpInjection,
  type HttpPreset,
  type HttpWhenAbsent,
} from '@/utils/agents/httpDefinition'

export type HostRow = { id: string; host: string; port: string; path: string }

/** One secret and the single place a request carries it. */
export type CredentialRow = {
  id: string
  /** The secret field name. Empty on a new row, where it is derived. */
  field: string
  headerName: string
  prefix: string
  queryName: string
  usernameField: string
  username: string
  usernameEnv: string
  env: string
  decoyPrefix: string
}

export type CustomConnectionForm = {
  name: string
  preset: HttpPreset
  hosts: HostRow[]
  credentials: CredentialRow[]
  blockWhenAbsent: boolean
  allowPlainHttp: boolean
  /** Field order of the definition this form was read from, kept on save. */
  fieldOrder: string[]
  /** How calls are classified for access policies. The form does not edit it; it is kept as read. */
  operationClasses?: HttpDefinition['operationClasses']
}

export type FormIssue = {
  /** Which input the issue belongs to, e.g. `host:<rowId>:port`. */
  key: string
  message: string
  /** A required value that is still empty: blocks saving, shown only as a required mark. */
  missing?: boolean
}

export const HTTP_PRESETS: Array<{ value: HttpPreset; label: string; description: string }> = [
  {
    value: 'bearer',
    label: 'Bearer token',
    description: 'Sent as Authorization: Bearer <token>.',
  },
  {
    value: 'basic',
    label: 'Basic auth',
    description: 'A username and a password, sent as HTTP Basic authentication.',
  },
  {
    value: 'headers',
    label: 'Custom headers',
    description: 'One or more secrets, each in a header you name.',
  },
  {
    value: 'query',
    label: 'Query parameter',
    description: 'Appended to the URL as a query parameter.',
  },
]

let rowSequence = 0
const nextRowId = () => `row-${(rowSequence += 1)}`

export const newHostRow = (): HostRow => ({ id: nextRowId(), host: '', port: '', path: '' })

const blankCredential = (): CredentialRow => ({
  id: nextRowId(),
  field: '',
  headerName: '',
  prefix: '',
  queryName: '',
  usernameField: '',
  username: '',
  usernameEnv: '',
  env: '',
  decoyPrefix: '',
})

/**
 * The starting row for a preset. `keep` carries the secret's identity over, so changing only
 * where a secret goes does not ask for it again.
 */
export const presetCredential = (preset: HttpPreset, keep?: CredentialRow): CredentialRow => {
  const row: CredentialRow = {
    ...blankCredential(),
    ...(keep
      ? { id: keep.id, field: keep.field, env: keep.env, decoyPrefix: keep.decoyPrefix }
      : {}),
  }
  if (preset === 'bearer') return { ...row, headerName: 'Authorization', prefix: 'Bearer ' }
  if (preset === 'query') return { ...row, queryName: 'api_key' }
  return row
}

export const emptyCustomConnectionForm = (name = ''): CustomConnectionForm => ({
  name,
  preset: 'bearer',
  hosts: [newHostRow()],
  credentials: [presetCredential('bearer')],
  blockWhenAbsent: false,
  allowPlainHttp: false,
  fieldOrder: [],
})

export const withPreset = (form: CustomConnectionForm, preset: HttpPreset): CustomConnectionForm =>
  preset === form.preset
    ? form
    : { ...form, preset, credentials: [presetCredential(preset, form.credentials[0])] }

// --- Validation, mirroring the backend validator -------------------------

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const NUMERIC_HOST_LABEL = /^(?:[0-9]+|0x[0-9a-f]*)$/
const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const FIELD_NAME = /^[a-z][a-z0-9]{0,31}$/
const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,63}$/
const DECOY_PREFIX = /^[A-Za-z0-9_-]{0,16}$/

const REFUSED_HEADERS = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'proxy-authorization',
  'proxy-connection',
  'upgrade',
  'te',
  'trailer',
])

const RESERVED_ENVIRONMENT_NAMES = new Set([
  'PATH',
  'HOME',
  'SHELL',
  'USER',
  'PWD',
  'TMPDIR',
  'NODE_OPTIONS',
  'PYTHONPATH',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  // Names the packaged AWS and PostgreSQL services manage. The server reads
  // these from its service registry and stays the authority on the list.
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_SECURITY_TOKEN',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  'AWS_DEFAULT_PROFILE',
  'AWS_ROLE_ARN',
  'AWS_ROLE_SESSION_NAME',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'PGUSER',
  'PGPASSWORD',
  'PGDATABASE',
  'PGPASSFILE',
  'PGSERVICE',
  'PGSERVICEFILE',
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRESQL_URL',
])
const RESERVED_ENVIRONMENT_PREFIXES = ['PHASE_', 'LD_', 'DYLD_', 'GIT_']

/** Why an environment variable name is refused, or ''. */
export const environmentNameProblem = (name: string): string => {
  if (!ENVIRONMENT_NAME.test(name))
    return 'Use upper-case letters, digits and underscores, starting with a letter (at most 64 characters).'
  if (/_[0-9]/.test(name)) return 'A digit cannot directly follow an underscore.'
  if (
    RESERVED_ENVIRONMENT_NAMES.has(name) ||
    RESERVED_ENVIRONMENT_PREFIXES.some((prefix) => name.startsWith(prefix))
  )
    return `${name} is reserved.`
  return ''
}

export type ParsedHost = { match: 'exact' | 'suffix'; value: string }

/**
 * Read a host as typed: `api.example.com`, or `*.example.com` for a domain
 * and its subdomains. Returns the rule, or a message saying what is wrong.
 */
export const parseHostInput = (input: string): ParsedHost | { error: string } => {
  let text = input.trim().toLowerCase().replace(/\.+$/, '')
  if (!text) return { error: 'Enter a host name.' }
  if (text.includes('://') || text.includes('/'))
    return { error: 'Enter the host name only, without a scheme or a path.' }
  const suffix = text.startsWith('*.')
  if (suffix) text = text.slice(1)
  if (text.includes('*'))
    return { error: 'A wildcard is only allowed as a leading *. for subdomains.' }
  if (!suffix && text.startsWith('.'))
    return { error: 'Use *.example.com to match a domain and its subdomains.' }

  const hostname = suffix ? text.slice(1) : text
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  const isAddress =
    ipaddr.IPv4.isValidFourPartDecimal(bare) ||
    (bare.includes(':') && !bare.includes('%') && ipaddr.IPv6.isValid(bare))
  if (isAddress) {
    if (suffix) return { error: 'An IP address cannot match subdomains.' }
    return { match: 'exact', value: bare }
  }
  if (hostname.includes(':'))
    return { error: 'Enter the port in its own field, not after the host name.' }
  if (hostname.length > HTTP_LIMITS.hostName) return { error: 'The host name is too long.' }
  const labels = hostname.split('.')
  if (labels.some((label) => !HOST_LABEL.test(label)))
    return { error: 'Use letters, digits, hyphens and dots only.' }
  if (NUMERIC_HOST_LABEL.test(labels[labels.length - 1]))
    return { error: 'A host name cannot end in a number; enter the full IP address instead.' }
  if (suffix && labels.length < 2)
    return { error: 'A subdomain match needs a domain below a top-level domain.' }
  return suffix ? { match: 'suffix', value: `.${hostname}` } : { match: 'exact', value: hostname }
}

/** The host as it is typed back into the form. */
export const hostInputFor = (rule: Pick<HttpHostRule, 'match' | 'value'>) =>
  rule.match === 'suffix' ? `*${rule.value}` : rule.value

const sanitizeFieldName = (source: string, fallback: string) => {
  let name = source.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (name && !/^[a-z]/.test(name)) name = `h${name}`
  return (name || fallback).slice(0, HTTP_LIMITS.fieldName)
}

const uniqueFieldName = (base: string, taken: Set<string>) => {
  let name = base
  for (let suffix = 2; taken.has(name); suffix += 1) {
    const tail = String(suffix)
    name = `${base.slice(0, HTTP_LIMITS.fieldName - tail.length)}${tail}`
  }
  taken.add(name)
  return name
}

const isHeaderPreset = (preset: HttpPreset) => preset === 'bearer' || preset === 'headers'

export type BuiltDefinition = {
  /** Null while any issue remains. */
  definition: HttpDefinition | null
  issues: FormIssue[]
  /** The secret field name each credential row writes, by row id. */
  secretFields: Record<string, string>
}

/**
 * Validate the form and build its definition. The definition is canonical: a
 * save of an untouched, read-back form sends back what was stored.
 */
export const buildCustomConnectionDefinition = (form: CustomConnectionForm): BuiltDefinition => {
  const issues: FormIssue[] = []
  const invalid = (key: string, message: string) => issues.push({ key, message })
  const missing = (key: string, message: string) => issues.push({ key, message, missing: true })

  const name = form.name.trim()
  if (!name) missing('name', 'Enter a name.')
  else if (name.length > HTTP_LIMITS.connectionName)
    invalid('name', `Use at most ${HTTP_LIMITS.connectionName} characters.`)

  // Hosts. A row left entirely blank is ignored.
  const hosts: HttpHostRule[] = []
  const seenHosts = new Set<string>()
  const filledHosts = form.hosts.filter((row) => row.host.trim() || row.port.trim() || row.path)
  if (filledHosts.length === 0) missing('hosts', 'Add at least one allowed host.')
  if (filledHosts.length > HTTP_LIMITS.hosts)
    invalid('hosts', `Use at most ${HTTP_LIMITS.hosts} hosts.`)
  for (const row of filledHosts) {
    const key = `host:${row.id}`
    if (!row.host.trim()) {
      missing(`${key}:host`, 'Enter a host name.')
      continue
    }
    const parsed = parseHostInput(row.host)
    if ('error' in parsed) {
      invalid(`${key}:host`, parsed.error)
      continue
    }
    const rule: HttpHostRule = { match: parsed.match, value: parsed.value }
    const portText = row.port.trim()
    if (portText) {
      const port = /^[0-9]{1,5}$/.test(portText) ? Number(portText) : NaN
      if (!(port >= 1 && port <= 65535)) {
        invalid(`${key}:port`, 'Enter a port from 1 to 65535.')
        continue
      }
      rule.port = port
    }
    if (row.path) {
      if (!row.path.trim() || !row.path.startsWith('/')) {
        invalid(`${key}:path`, 'A path starts with /.')
        continue
      }
      if (row.path.length > HTTP_LIMITS.path || CONTROL_CHARACTER.test(row.path)) {
        invalid(
          `${key}:path`,
          `Use at most ${HTTP_LIMITS.path} characters without control characters.`
        )
        continue
      }
      rule.path = row.path
    }
    const identity = JSON.stringify([rule.match, rule.value, rule.port ?? null, rule.path ?? null])
    if (seenHosts.has(identity)) {
      invalid(`${key}:host`, 'This host is listed twice.')
      continue
    }
    seenHosts.add(identity)
    hosts.push(rule)
  }

  // Credentials.
  const rows = form.preset === 'headers' ? form.credentials : form.credentials.slice(0, 1)
  if (rows.length === 0) missing('credentials', 'Add at least one header.')
  if (rows.length > HTTP_LIMITS.injections)
    invalid('credentials', `Use at most ${HTTP_LIMITS.injections} headers.`)

  const whenAbsent: HttpWhenAbsent = form.blockWhenAbsent ? 'block' : 'attach'
  const takenFields = new Set<string>()
  for (const row of rows) {
    if (FIELD_NAME.test(row.field)) takenFields.add(row.field)
    if (form.preset === 'basic' && FIELD_NAME.test(row.usernameField))
      takenFields.add(row.usernameField)
  }
  const seenHeaders = new Set<string>()
  const seenEnvironment = new Set<string>()
  const fields: HttpField[] = []
  const injections: HttpInjection[] = []
  const secretFields: Record<string, string> = {}

  const checkEnvironment = (key: string, value: string): string | undefined => {
    const environment = value.trim()
    if (!environment) return undefined
    const problem = environmentNameProblem(environment)
    if (problem) {
      invalid(key, problem)
      return undefined
    }
    if (seenEnvironment.has(environment)) {
      invalid(key, `${environment} is already used by another field.`)
      return undefined
    }
    seenEnvironment.add(environment)
    return environment
  }

  rows.forEach((row, index) => {
    const key = `cred:${row.id}`
    let fallbackName = 'token'
    let injection: HttpInjection | null = null

    if (isHeaderPreset(form.preset)) {
      const header = row.headerName.trim()
      fallbackName = form.preset === 'bearer' ? 'token' : `secret${index + 1}`
      if (!header) missing(`${key}:headerName`, 'Enter a header name.')
      else if (header.length > HTTP_LIMITS.injectionName || !HEADER_TOKEN.test(header))
        invalid(`${key}:headerName`, 'Enter a valid HTTP header name.')
      else if (REFUSED_HEADERS.has(header.toLowerCase()))
        invalid(`${key}:headerName`, `The ${header} header cannot be set.`)
      else if (seenHeaders.has(header.toLowerCase()))
        invalid(`${key}:headerName`, `The ${header} header is already set by another row.`)
      else {
        seenHeaders.add(header.toLowerCase())
        if (form.preset === 'headers') fallbackName = sanitizeFieldName(header, fallbackName)
        injection = { type: 'header', name: header, field: '', whenAbsent }
      }
      if (
        row.prefix.length > HTTP_LIMITS.headerPrefix ||
        CONTROL_CHARACTER.test(row.prefix) ||
        /[{}]/.test(row.prefix)
      ) {
        invalid(
          `${key}:prefix`,
          `Use at most ${HTTP_LIMITS.headerPrefix} characters without braces or control characters.`
        )
        injection = null
      } else if (injection && row.prefix) injection.prefix = row.prefix
    } else if (form.preset === 'query') {
      const parameter = row.queryName
      if (!parameter.trim()) missing(`${key}:queryName`, 'Enter a parameter name.')
      else if (parameter.length > HTTP_LIMITS.injectionName || /[&=\u0000]/.test(parameter))
        invalid(`${key}:queryName`, 'A parameter name cannot contain & or =.')
      else injection = { type: 'query', name: parameter, field: '', whenAbsent }
    } else {
      fallbackName = 'password'
      const username = row.username
      let usernameOk = true
      if (!username) {
        missing(`${key}:username`, 'Enter a username.')
        usernameOk = false
      } else if (
        username.length > HTTP_LIMITS.identifierValue ||
        CONTROL_CHARACTER.test(username)
      ) {
        invalid(
          `${key}:username`,
          `Use at most ${HTTP_LIMITS.identifierValue} characters without control characters.`
        )
        usernameOk = false
      }
      const usernameEnvironment = checkEnvironment(`${key}:usernameEnv`, row.usernameEnv)
      if (usernameOk) {
        const usernameField = FIELD_NAME.test(row.usernameField)
          ? row.usernameField
          : uniqueFieldName('username', takenFields)
        fields.push({
          name: usernameField,
          kind: 'identifier',
          value: username,
          ...(usernameEnvironment ? { env: usernameEnvironment } : {}),
        })
        injection = { type: 'basic', usernameField, field: '', whenAbsent }
      }
    }

    const environment = checkEnvironment(`${key}:env`, row.env)
    if (!DECOY_PREFIX.test(row.decoyPrefix))
      invalid(
        `${key}:decoyPrefix`,
        `Use at most ${HTTP_LIMITS.decoyPrefix} letters, digits, underscores or hyphens.`
      )
    const fieldName = FIELD_NAME.test(row.field)
      ? row.field
      : uniqueFieldName(fallbackName, takenFields)
    secretFields[row.id] = fieldName
    fields.push({
      name: fieldName,
      kind: 'secret',
      source: { type: 'sealed' },
      ...(environment ? { env: environment } : {}),
      ...(row.decoyPrefix && DECOY_PREFIX.test(row.decoyPrefix)
        ? { decoyPrefix: row.decoyPrefix }
        : {}),
    })
    if (injection) injections.push({ ...injection, field: fieldName })
  })

  if (fields.length > HTTP_LIMITS.fields)
    invalid('credentials', `Use at most ${HTTP_LIMITS.fields} fields.`)

  if (issues.length > 0) return { definition: null, issues, secretFields }

  // Keep the order of the definition the form was read from.
  const order = (fieldName: string) => {
    const index = form.fieldOrder.indexOf(fieldName)
    return index < 0 ? form.fieldOrder.length : index
  }
  const orderedFields = fields
    .map((field, index) => ({ field, index }))
    .sort(
      (left, right) => order(left.field.name) - order(right.field.name) || left.index - right.index
    )
    .map(({ field }) => field)

  return {
    definition: {
      specVersion: HTTP_SPEC_VERSION,
      hosts,
      fields: orderedFields,
      injections,
      preset: form.preset,
      // Stored only when set, so the default has one spelling.
      ...(form.allowPlainHttp ? { allowPlainHttp: true } : {}),
      ...(form.operationClasses?.length ? { operationClasses: form.operationClasses } : {}),
    },
    issues,
    secretFields,
  }
}

/** A definition with every default written out, for comparing two of them. */
export const canonicalDefinition = (definition: HttpDefinition) => ({
  hosts: definition.hosts.map((rule) => ({
    match: rule.match,
    value: rule.value,
    ...(rule.port === undefined || rule.port === null ? {} : { port: rule.port }),
    ...(rule.path ? { path: rule.path } : {}),
  })),
  fields: definition.fields.map((field) =>
    field.kind === 'secret'
      ? {
          name: field.name,
          kind: field.kind,
          source: { type: field.source?.type ?? 'sealed' },
          ...(field.env ? { env: field.env } : {}),
          ...(field.decoyPrefix ? { decoyPrefix: field.decoyPrefix } : {}),
        }
      : {
          name: field.name,
          kind: field.kind,
          value: field.value,
          ...(field.env ? { env: field.env } : {}),
        }
  ),
  injections: definition.injections.map((injection) => ({
    ...(injection.type === 'basic'
      ? { type: injection.type, usernameField: injection.usernameField }
      : {
          type: injection.type,
          name: injection.name,
          ...(injection.type === 'header' && injection.prefix ? { prefix: injection.prefix } : {}),
        }),
    field: injection.field,
    whenAbsent: injection.whenAbsent ?? 'attach',
  })),
  allowPlainHttp: definition.allowPlainHttp === true,
  operationClasses: definition.operationClasses ?? [],
})

/** Whether two definitions mean the same thing. The preset is only a UI hint. */
export const sameDefinition = (left: HttpDefinition, right: HttpDefinition) =>
  isEqual(canonicalDefinition(left), canonicalDefinition(right))

const inferPreset = (definition: HttpDefinition): HttpPreset | null => {
  const types = new Set(definition.injections.map((injection) => injection.type))
  if (types.size !== 1) return null
  const [first] = definition.injections
  if (first.type === 'basic') return definition.injections.length === 1 ? 'basic' : null
  if (first.type === 'query') return definition.injections.length === 1 ? 'query' : null
  const bearer =
    definition.injections.length === 1 &&
    first.name.toLowerCase() === 'authorization' &&
    first.prefix === 'Bearer '
  return bearer && definition.preset !== 'headers' ? 'bearer' : 'headers'
}

/**
 * Read a definition into form state. Returns null when the form cannot express it exactly,
 * so the caller shows it read-only.
 */
export const customConnectionFormFromDefinition = (
  name: string,
  definition: HttpDefinition
): CustomConnectionForm | null => {
  if (definition.injections.length === 0 || definition.hosts.length === 0) return null
  const preset = inferPreset(definition)
  if (!preset) return null
  const modes = new Set(definition.injections.map((injection) => injection.whenAbsent ?? 'attach'))
  if (modes.size !== 1) return null

  const credentials = definition.injections.map((injection): CredentialRow => {
    const secret = definition.fields.find(
      (field) => field.kind === 'secret' && field.name === injection.field
    )
    const row: CredentialRow = {
      ...blankCredential(),
      field: injection.field,
      env: secret?.env ?? '',
      decoyPrefix: (secret?.kind === 'secret' && secret.decoyPrefix) || '',
    }
    if (injection.type === 'header')
      return { ...row, headerName: injection.name, prefix: injection.prefix ?? '' }
    if (injection.type === 'query') return { ...row, queryName: injection.name }
    const username = definition.fields.find(
      (field) => field.kind === 'identifier' && field.name === injection.usernameField
    )
    return {
      ...row,
      usernameField: injection.usernameField,
      username: username?.kind === 'identifier' ? username.value : '',
      usernameEnv: username?.env ?? '',
    }
  })

  const form: CustomConnectionForm = {
    name,
    preset,
    hosts: definition.hosts.map((rule) => ({
      id: nextRowId(),
      host: hostInputFor(rule),
      port: rule.port === undefined || rule.port === null ? '' : String(rule.port),
      path: rule.path ?? '',
    })),
    credentials,
    blockWhenAbsent: modes.has('block'),
    allowPlainHttp: definition.allowPlainHttp === true,
    fieldOrder: definition.fields.map((field) => field.name),
    ...(definition.operationClasses?.length
      ? { operationClasses: definition.operationClasses }
      : {}),
  }
  // Only a form that builds back to the same definition may edit it.
  const rebuilt = buildCustomConnectionDefinition({ ...form, name: name || 'connection' })
  if (!rebuilt.definition || !sameDefinition(rebuilt.definition, definition)) return null
  return form
}

/** Secrets typed against credential rows, keyed by the field each row writes. */
export const secretsByField = (
  secretFields: Record<string, string>,
  entered: Record<string, string>
): Record<string, string> => {
  const byField: Record<string, string> = {}
  for (const [rowId, field] of Object.entries(secretFields)) {
    if (entered[rowId]) byField[field] = entered[rowId]
  }
  return byField
}
