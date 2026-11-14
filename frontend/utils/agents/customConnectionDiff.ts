/**
 * A readable diff between a custom Connection as it is and as a request
 * asks for it: name, hosts, injections, fields and settings.
 */

import {
  describeHttpHost,
  describeHttpInjection,
  type HttpDefinition,
  type HttpField,
  type HttpHostRule,
  type HttpInjection,
  type HttpOperationClass,
} from '@/utils/agents/httpDefinition'

export type DiffChange = 'added' | 'removed' | 'changed' | 'unchanged'

export type DiffEntry = {
  change: DiffChange
  /** What the entry is, e.g. a host or a header name. */
  label: string
  before?: string
  after?: string
}

export type ConnectionSnapshot = {
  name?: string | null
  definition?: HttpDefinition | null
}

export type ConnectionDiff = {
  name: DiffEntry | null
  hosts: DiffEntry[]
  injections: DiffEntry[]
  fields: DiffEntry[]
  /** How calls are classified for access rules. */
  operationClasses: DiffEntry[]
  settings: DiffEntry[]
  /** False when the request changes nothing. */
  changed: boolean
}

const boundKey = (rule: HttpHostRule) =>
  JSON.stringify([rule.value.toLowerCase(), rule.match, rule.port ?? null])

const diffHosts = (before: HttpHostRule[], after: HttpHostRule[]): DiffEntry[] => {
  const beforeText = before.map(describeHttpHost)
  const afterText = after.map(describeHttpHost)
  const removed = before.filter((_, index) => !afterText.includes(beforeText[index]))
  const added = after.filter((_, index) => !beforeText.includes(afterText[index]))
  const entries: DiffEntry[] = []
  const paired = new Set<HttpHostRule>()
  for (const rule of after) {
    const text = describeHttpHost(rule)
    if (!added.includes(rule)) {
      entries.push({ change: 'unchanged', label: text, before: text, after: text })
      continue
    }
    // The same host with another path reads as one change, when it is unambiguous.
    const sameHostRemoved = removed.filter((candidate) => boundKey(candidate) === boundKey(rule))
    const sameHostAdded = added.filter((candidate) => boundKey(candidate) === boundKey(rule))
    if (sameHostRemoved.length === 1 && sameHostAdded.length === 1) {
      paired.add(sameHostRemoved[0])
      entries.push({
        change: 'changed',
        label: describeHttpHost({ ...rule, path: undefined }),
        before: describeHttpHost(sameHostRemoved[0]),
        after: text,
      })
    } else entries.push({ change: 'added', label: text, after: text })
  }
  for (const rule of removed) {
    if (paired.has(rule)) continue
    const text = describeHttpHost(rule)
    entries.push({ change: 'removed', label: text, before: text })
  }
  return entries
}

const injectionKey = (injection: HttpInjection) =>
  injection.type === 'basic'
    ? 'basic'
    : injection.type === 'header'
      ? `header:${injection.name.toLowerCase()}`
      : `query:${injection.name}`

const injectionLabel = (injection: HttpInjection) =>
  injection.type === 'basic'
    ? 'Basic auth'
    : injection.type === 'header'
      ? `${injection.name} header`
      : `${injection.name} query parameter`

const describeField = (field: HttpField) => {
  const parts =
    field.kind === 'secret'
      ? ['secret', field.decoyPrefix ? `placeholder prefix ${field.decoyPrefix}` : '']
      : [`identifier ${field.value}`]
  if (field.env) parts.push(`exported as ${field.env}`)
  return parts.filter(Boolean).join(', ')
}

const diffKeyed = <T>(
  before: T[],
  after: T[],
  key: (item: T) => string,
  label: (item: T) => string,
  describe: (item: T, side: 'before' | 'after') => string
): DiffEntry[] => {
  const previous = new Map(before.map((item) => [key(item), item]))
  const next = new Set(after.map(key))
  const entries: DiffEntry[] = after.map((item) => {
    const old = previous.get(key(item))
    const text = describe(item, 'after')
    if (!old) return { change: 'added', label: label(item), after: text }
    const oldText = describe(old, 'before')
    return {
      change: oldText === text ? 'unchanged' : 'changed',
      label: label(item),
      before: oldText,
      after: text,
    }
  })
  for (const item of before) {
    if (next.has(key(item))) continue
    entries.push({ change: 'removed', label: label(item), before: describe(item, 'before') })
  }
  return entries
}

const classMatchKey = (entry: HttpOperationClass) =>
  JSON.stringify([
    (entry.match.methods ?? []).map((method) => method.toUpperCase()).sort(),
    entry.match.path ?? '',
  ])

const classMatchLabel = (entry: HttpOperationClass) =>
  [(entry.match.methods ?? []).join(', '), entry.match.path].filter(Boolean).join(' ') || 'Any call'

const describeClass = (entry: HttpOperationClass) => `counted as ${entry.class} calls`

const diffOperationClasses = (
  before: HttpOperationClass[],
  after: HttpOperationClass[]
): DiffEntry[] => {
  const entries = diffKeyed(before, after, classMatchKey, classMatchLabel, describeClass)
  // The first match wins, so the same rules in another order are a change too.
  const keptBefore = before
    .map(classMatchKey)
    .filter((key) => after.some((a) => classMatchKey(a) === key))
  const keptAfter = after
    .map(classMatchKey)
    .filter((key) => before.some((b) => classMatchKey(b) === key))
  if (keptBefore.join() !== keptAfter.join()) {
    const order = (items: HttpOperationClass[], kept: string[]) =>
      items
        .filter((item) => kept.includes(classMatchKey(item)))
        .map(classMatchLabel)
        .join(', then ')
    entries.push({
      change: 'changed',
      label: 'Order',
      before: order(before, keptBefore),
      after: order(after, keptAfter),
    })
  }
  return entries
}

/**
 * Compare a Connection as it is with what is requested. `current` is null for
 * a new Connection; a missing requested name or definition means "unchanged".
 */
export const diffConnections = (
  current: ConnectionSnapshot | null | undefined,
  requested: ConnectionSnapshot | null | undefined
): ConnectionDiff => {
  const beforeName = current?.name ?? null
  const afterName = requested?.name ?? beforeName
  const before = current?.definition ?? null
  const after = requested?.definition ?? before

  const name: DiffEntry | null =
    afterName === null && beforeName === null
      ? null
      : beforeName === null
        ? { change: 'added', label: 'Name', after: afterName ?? '' }
        : {
            change: beforeName === afterName ? 'unchanged' : 'changed',
            label: 'Name',
            before: beforeName,
            after: afterName ?? beforeName,
          }

  const hosts = diffHosts(before?.hosts ?? [], after?.hosts ?? [])
  const injections = diffKeyed(
    before?.injections ?? [],
    after?.injections ?? [],
    injectionKey,
    injectionLabel,
    (injection, side) =>
      describeHttpInjection(injection, (side === 'before' ? before : after) ?? { fields: [] })
  )
  const fields = diffKeyed(
    before?.fields ?? [],
    after?.fields ?? [],
    (field) => field.name,
    (field) => field.name,
    describeField
  )

  const operationClasses = diffOperationClasses(
    before?.operationClasses ?? [],
    after?.operationClasses ?? []
  )

  const settings: DiffEntry[] = []
  const plainBefore = before?.allowPlainHttp === true
  const plainAfter = after?.allowPlainHttp === true
  if (plainBefore || plainAfter) {
    const say = (allowed: boolean) => (allowed ? 'allowed' : 'not allowed')
    settings.push({
      change: !before ? 'added' : plainBefore === plainAfter ? 'unchanged' : 'changed',
      label: 'Plain HTTP',
      ...(before ? { before: say(plainBefore) } : {}),
      after: say(plainAfter),
    })
  }

  const changed = [name, ...hosts, ...injections, ...fields, ...operationClasses, ...settings].some(
    (entry) => entry && entry.change !== 'unchanged'
  )
  return { name, hosts, injections, fields, operationClasses, settings, changed }
}
