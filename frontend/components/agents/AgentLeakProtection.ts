/**
 * Leak protection events, in words. The CLI replaces secret values with
 * `ph:<type>:<id>` placeholders and reports them as `leak_protection` events,
 * never with the value itself.
 */

import { AGENT_WORD_SPELLINGS } from '@/components/agents/AgentEnums'
import type { AgentEventRow } from '@/components/agents/AgentEventLogUtils'
import { describeDuration } from '@/utils/agents/accessDuration'
import { listWords } from '@/utils/agents/appAccess'

export const LEAK_PROTECTION_EVENT = 'leak_protection'

export type LeakTone = 'danger' | 'warning' | 'neutral'

export type LeakDetailRow = { label: string; lines: string[] }

export type LeakSecretLocation = {
  appId: string
  environmentId: string
  path: string
  secretId: string
}

/** Where the secret behind a placeholder lives, as far as the viewer may see. */
export type LeakSecret = {
  label: string
  /** The backend left out the name of an app or environment the viewer cannot access. */
  withheld: boolean
  location: LeakSecretLocation | null
}

export type LeakPlaceholder = { text: string; secret: LeakSecret | null }

export type LeakProtection = {
  headline: string
  tone: LeakTone
  /** Set when the event carries a severity. */
  severity: { label: string; tone: LeakTone } | null
  /** The outcome in a word or two, for the log's Status column. */
  outcome: string
  /** The AI tool, and how its request reached Phase; '' when the event does not say. */
  tool: string
  capture: string
  /** The expanded detail, in the order it is shown. */
  rows: LeakDetailRow[]
  placeholders: LeakPlaceholder[]
  /** Distinct secrets in the request that the event does not name. */
  unlistedPlaceholders: number
  /** Says so, in words; '' when the event names every one. */
  unlistedNote: string
  /** Shown once beside the placeholders when one of them has no id; '' otherwise. */
  placeholderNote: string
  /** Detail members not known here, so that nothing the CLI sent is hidden. */
  other: Record<string, unknown>
}

/** The contract's detail members. The Console's ingest stores keys in snake case. */
const DETAIL_KEYS = [
  'mode',
  'harness',
  'capture',
  'severity',
  'where',
  'inventoryHits',
  'ruleRedactions',
  'ruleAlerts',
  'signedFindings',
  'placeholderCount',
  'replacedCount',
  'windowSeconds',
  'scope',
  'labels',
  'placeholders',
  // Added by the Console: where the secrets behind the placeholders live.
  'secrets',
] as const
type DetailKey = (typeof DETAIL_KEYS)[number]
type Detail = Record<string, unknown>

/** An event names at most this many placeholders. */
const MAX_PLACEHOLDERS = 20

/** A count above this reads "more than 10,000". */
const MAX_COUNT = 10_000

/** A pause longer than this reads "more than a day". */
const MAX_WINDOW_SECONDS = 24 * 60 * 60

/**
 * For a login that is not an Agent token the CLI sends a placeholder as `ph:<type>`,
 * without the id, because the id would be the secret's key name.
 */
const KEY_NAMES_NOT_SENT = 'Key names are not sent for this login.'

const TOOLS: Record<string, string> = {
  claude: 'Claude Code',
  claude_code: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
}

const CAPTURES: Record<string, string> = { proxy: 'Phase AI proxy', tunnel: 'phase up' }

const OUTCOMES: Record<string, string> = {
  censored: 'Censored',
  observed: 'Observed',
  reported: 'Reported',
  denied: 'Blocked',
  unread: 'Not read',
  bypass: 'Reading paused',
}

const SEVERITY_TONES: Record<string, LeakTone> = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
}

/** Why something was not read, worded to follow a colon. */
const REASONS: Record<string, string> = {
  body_over_limit: 'the body was over the size limit',
  body_undecodable: 'the body could not be decoded',
  message_not_json: 'it was not JSON',
  message_compressed: 'it was compressed',
  message_binary: 'it was binary',
  tls_refused: "the tool refused Phase's certificate",
  hello_unreadable: "the tool's TLS hello could not be read",
  hello_resumption: 'the tool offered to resume an earlier secure session that Phase cannot copy',
  hello_not_mirrored: "the tool's TLS hello could not be copied",
  upstream_handshake_failed: 'the service did not accept the connection Phase opened',
  upstream_not_http1: 'the service chose a protocol Phase does not read here',
}

/** Says only that something was found, which every headline already does. */
const FOUND_REASON = 'secret_in_request'

/** Token formats whose label does not read well as words. */
const LABELS: Record<string, string> = {
  keyword_secret: 'Value after a secret-sounding name',
}

const SPELLINGS: Record<string, string> = {
  ...AGENT_WORD_SPELLINGS,
  agent: 'Agent',
  cli: 'CLI',
  digitalocean: 'DigitalOcean',
  huggingface: 'Hugging Face',
  json: 'JSON',
  jwt: 'JWT',
  npm: 'npm',
  oauth: 'OAuth',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  pat: 'personal access token',
  phase: 'Phase',
  pypi: 'PyPI',
  sendgrid: 'SendGrid',
  slack: 'Slack',
  ssh: 'SSH',
  stripe: 'Stripe',
  tls: 'TLS',
  url: 'URL',
}

const isRecord = (value: unknown): value is Detail =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const lower = (value?: string | null) => value?.trim().toLowerCase() || ''

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const parts = (identifier: string) =>
  identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase())

/** `body_over_limit` is "body over limit": an identifier not known here still reads as words. */
const words = (identifier: string) =>
  parts(identifier)
    .map((part) => SPELLINGS[part] ?? part)
    .join(' ')

/**
 * The same with a capital to start: `aws_access_key_id` is "AWS access key ID" and
 * `private_key` is "Private key". A word with a spelling of its own keeps it: "npm token".
 */
const sentence = (identifier: string) =>
  parts(identifier)
    .map((part, index) => SPELLINGS[part] ?? (index ? part : capitalise(part)))
    .join(' ')

const snakeCase = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

const KNOWN_KEYS = new Set<string>(DETAIL_KEYS.flatMap((key) => [key, snakeCase(key)]))

const member = (detail: Detail, key: DetailKey) => detail[key] ?? detail[snakeCase(key)]

const text = (detail: Detail, key: DetailKey) => {
  const value = member(detail, key)
  return typeof value === 'string' ? value.trim() : ''
}

/** A count the event carries, as a whole number not below zero; null when it carries none. */
const given = (detail: Detail, key: DetailKey) => {
  const value = member(detail, key)
  const number = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number)
    ? Math.max(0, Math.floor(number))
    : null
}

const count = (detail: Detail, key: DetailKey) => given(detail, key) ?? 0

/** A count in words: 3, or "more than 10,000" for a count no request holds. */
const amount = (value: number) => (value > MAX_COUNT ? 'more than 10,000' : `${value}`)

/** "1 known secret value", "3 known secret values", "more than 10,000 known secret values". */
const counted = (value: number, one: string, many: string) =>
  `${amount(value)} ${value === 1 ? one : many}`

const pause = (seconds: number) =>
  seconds > MAX_WINDOW_SECONDS ? 'more than a day' : describeDuration(seconds)

const list = (detail: Detail, key: DetailKey) => {
  const value = member(detail, key)
  if (typeof value !== 'string') return []
  const items = value.split(',').map((item) => item.trim())
  return [...new Set(items.filter(Boolean))]
}

/** The name for a value that has one, else the value as words; '' for no value. */
const named = (names: Record<string, string>, value?: string | null) =>
  lower(value) ? names[lower(value)] ?? sentence(value || '') : ''

const secretValues = (found: number) =>
  found ? counted(found, 'secret value', 'secret values') : 'secret values'

const someSecrets = (found: number) =>
  found > 1 ? counted(found, 'secret', 'secrets') : 'a secret'

/** A place a finding sat, as a blocked request's headline names it. */
const BLOCKED_PLACES: Record<string, string> = {
  url: 'its URL',
  body: 'its body',
  header: 'a header',
}

/** The same, for a finding that was left where it was. */
const LEFT_PLACES: Record<string, string> = {
  url: 'the URL',
  body: 'the body',
  header: 'a header',
}

type Unit = 'request' | 'message' | 'connection'

const UNITS: readonly string[] = ['request', 'message', 'connection'] satisfies Unit[]

const reasonWords = (reason: string | null | undefined, unit: Unit) => {
  const known = REASONS[lower(reason)]
  if (!known) return lower(reason) === FOUND_REASON ? '' : words(reason || '')
  return unit === 'message' ? known.replace(/^the body /, 'it ') : known
}

const readSecret = (value: unknown): [string, LeakSecret] | null => {
  if (!isRecord(value) || typeof value.placeholder !== 'string') return null
  const read = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : '')
  const appName = read('app_name')
  const environmentName = read('environment_name')
  if (value.app_restricted === true || !appName)
    return [
      value.placeholder,
      { label: "A secret in an app you can't access", withheld: true, location: null },
    ]
  if (value.environment_restricted === true || !environmentName)
    return [
      value.placeholder,
      {
        label: `A secret in ${appName} (an environment you can't access)`,
        withheld: true,
        location: null,
      },
    ]
  const location = {
    appId: read('app_id'),
    environmentId: read('environment_id'),
    path: read('path') || '/',
    secretId: read('secret_id'),
  }
  return [
    value.placeholder,
    {
      label: `A secret in ${appName} (${environmentName})`,
      withheld: false,
      location: location.appId && location.environmentId && location.secretId ? location : null,
    },
  ]
}

/** The secret's own row on its environment's secrets page, as the secret logs link to it. */
export const leakSecretPath = (team: string, location: LeakSecretLocation) => {
  const folders = location.path.split('/').filter(Boolean).map(encodeURIComponent)
  const page = [
    `/${team}/apps/${location.appId}/environments/${location.environmentId}`,
    ...folders,
  ]
  return `${page.join('/')}?${new URLSearchParams({ secret: location.secretId })}`
}

/** A leak protection event in words; null for an event of any other type. */
export const describeLeakProtection = (event: AgentEventRow): LeakProtection | null => {
  // Matched exactly, as the backend matches it.
  if (event.eventType !== LEAK_PROTECTION_EVENT) return null
  const detail = isRecord(event.detail) ? event.detail : {}
  const reason = lower(event.reason)
  // A block is a block, whatever outcome came with it.
  const blocked = lower(event.proxyDecision) === 'block' || lower(event.outcome) === 'denied'
  const outcome = blocked ? 'denied' : lower(event.outcome)
  const host = event.host?.trim() || ''
  const severity = lower(text(detail, 'severity'))
  const places = list(detail, 'where').map((place) => place.toLowerCase())
  const inventory = count(detail, 'inventoryHits')
  const redactions = count(detail, 'ruleRedactions')
  const alerts = count(detail, 'ruleAlerts')
  const signed = count(detail, 'signedFindings')
  const distinct = count(detail, 'placeholderCount')
  const window = count(detail, 'windowSeconds')
  const scope = lower(text(detail, 'scope'))

  // The CLI says what an unread reason covers. Without that: a refused
  // certificate, a hello that cannot be used or a failed connection to the
  // service is about the connection; a WebSocket carries messages; everything
  // else is a request.
  const unit: Unit = UNITS.includes(scope)
    ? (scope as Unit)
    : /^(hello|tls|upstream)_/.test(reason) || lower(event.method) === 'connect'
      ? 'connection'
      : reason.startsWith('message_') || lower(event.protocol) === 'websocket'
        ? 'message'
        : 'request'
  const to = `a ${unit}${host ? ` to ${host}` : ''}`
  const why = reasonWords(event.reason, unit)
  // Distinct secrets when the event counts them, else what it found.
  const found = distinct || inventory + redactions || alerts
  // What a censored request had replaced: the CLI's own count of distinct secrets
  // replaced, else known values and token-shaped values replaced, never what was
  // only noted or left in signed text. null when the event counts nothing at all.
  const counts = (
    ['inventoryHits', 'ruleRedactions', 'ruleAlerts', 'signedFindings', 'placeholderCount'] as const
  ).some((key) => given(detail, key) !== null)
  const replaced = given(detail, 'replacedCount') ?? (counts ? inventory + redactions : null)

  const headline = (() => {
    if (outcome === 'denied') {
      const where = listWords(places.map((place) => BLOCKED_PLACES[place] ?? `its ${words(place)}`))
      return `Blocked ${to} with ${someSecrets(found)} in ${where || 'it'}`
    }
    if (outcome === 'censored')
      return replaced === 0
        ? `Checked ${to} and removed nothing`
        : `Removed ${secretValues(replaced ?? 0)} from ${to}`
    if (outcome === 'observed')
      return `Saw ${secretValues(found)} in ${to} (observe mode, nothing changed)`
    if (outcome === 'reported') {
      // Signed text sits in the body, so alone it is named instead of the body.
      const signedOnly = signed > 0 && inventory + redactions + alerts === 0
      const where = signedOnly
        ? ['signed text']
        : [
            ...places.map((place) => LEFT_PLACES[place] ?? `the ${words(place)}`),
            ...(signed ? ['signed text'] : []),
          ]
      const total = found + signed
      const sat = where.length ? `${listWords(where)}${host ? ` sent to ${host}` : ''}` : to
      return `Found ${someSecrets(total)} in ${sat} and left ${total > 1 ? 'them' : 'it'}`
    }
    if (outcome === 'unread') return `Did not read ${to}${why ? `: ${why}` : ''}`
    if (outcome === 'bypass') {
      const span = window ? pause(window) : 'a while'
      return `Not reading ${host || 'this host'} for ${span}: ${why || REASONS.tls_refused}`
    }
    const said = [words(event.outcome || ''), why].filter(Boolean).join(', ')
    return said ? `Leak protection on ${to}: ${said}` : `Leak protection checked ${to}`
  })()

  const rows: LeakDetailRow[] = []
  const add = (label: string, ...lines: string[]) => {
    const kept = lines.filter(Boolean)
    if (kept.length) rows.push({ label, lines: kept })
  }
  const tool = named(TOOLS, text(detail, 'harness'))
  const capture = named(CAPTURES, text(detail, 'capture'))
  add('Tool', tool)
  add('Captured by', capture)
  add('Mode', sentence(text(detail, 'mode')))
  add('Severity', sentence(severity))
  add('Found in', capitalise(listWords(places.map((place) => words(place)))))
  add(
    'Found',
    inventory ? counted(inventory, 'known secret value', 'known secret values') : '',
    redactions
      ? `${counted(redactions, 'token-shaped value', 'token-shaped values')} ${
          outcome === 'censored' ? 'replaced' : 'found'
        }`
      : '',
    alerts
      ? `${counted(alerts, 'token-shaped string', 'token-shaped strings')} noted, not replaced`
      : '',
    signed ? `${amount(signed)} found in signed text, left alone` : '',
    distinct
      ? `${counted(distinct, 'distinct secret', 'distinct secrets')} in the ${
          unit === 'message' ? 'message' : 'request'
        }`
      : ''
  )
  add(
    'Token formats',
    list(detail, 'labels')
      .map((label) => LABELS[label.toLowerCase()] ?? sentence(label))
      .join(', ')
  )
  add('Not reading for', window ? pause(window) : '')
  // The other headlines say the reason themselves.
  if (['denied', 'censored', 'observed', 'reported'].includes(outcome))
    add('Reason', capitalise(why))

  const resolved = new Map(
    (Array.isArray(detail.secrets) ? detail.secrets : []).flatMap((secret) => {
      const read = readSecret(secret)
      return read ? [read] : []
    })
  )
  const placeholders = list(detail, 'placeholders')
    .slice(0, MAX_PLACEHOLDERS)
    .map((placeholder) => ({ text: placeholder, secret: resolved.get(placeholder) ?? null }))
  const unlisted = Math.max(0, distinct - placeholders.length)

  return {
    headline,
    tone:
      outcome === 'denied' || severity === 'high'
        ? 'danger'
        : outcome === 'unread' || outcome === 'bypass'
          ? 'warning'
          : 'neutral',
    severity: severity
      ? {
          label: `${sentence(severity)} severity`,
          tone: SEVERITY_TONES[severity] ?? 'neutral',
        }
      : null,
    outcome: named(OUTCOMES, blocked ? outcome : event.outcome) || 'Unknown',
    tool,
    capture,
    rows,
    placeholders,
    unlistedPlaceholders: unlisted,
    unlistedNote: unlisted
      ? unlisted > MAX_COUNT
        ? 'More than 10,000 more not named in this event'
        : `+${unlisted} more not named in this event`
      : '',
    placeholderNote: placeholders.some(({ text }) => /^ph:[^:]+$/.test(text))
      ? KEY_NAMES_NOT_SENT
      : '',
    other: Object.fromEntries(Object.entries(detail).filter(([key]) => !KNOWN_KEYS.has(key))),
  }
}
