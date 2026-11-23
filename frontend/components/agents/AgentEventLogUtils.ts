export type AgentEventRow = {
  ingestSeq: string | number
  eventId: string
  proxyCreatedAt: string
  ingestedAt: string
  eventType: string
  protocol: string
  method?: string | null
  host?: string | null
  port?: number | null
  path?: string | null
  provider?: string | null
  statusCode?: number | null
  proxyDecision?: string | null
  outcome?: string | null
  latencyMs?: number | null
  credentialAction?: string | null
  bytesIn?: number | null
  bytesOut?: number | null
  reason?: string | null
  detail?: Record<string, unknown> | null
  workflow?: { id: string; name: string } | null
  connection?: { id: string; name: string } | null
  session?: { sessionUid: string } | null
}

export type AgentEventConnectionCandidate = {
  id: string
  name: string
  hostRulesVersion: string
  requiresHostReview?: boolean
  hostReviewPending?: boolean
}

export type AgentEventWorkflow = {
  id: string
  name: string
  connections: AgentEventConnectionCandidate[]
}

const eventKey = (event: AgentEventRow) => `${String(event.ingestSeq)}:${event.eventId}`

const compareIngestSequence = (left: AgentEventRow, right: AgentEventRow) => {
  try {
    const leftSequence = BigInt(String(left.ingestSeq))
    const rightSequence = BigInt(String(right.ingestSeq))
    return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : 0
  } catch {
    return String(left.ingestSeq).localeCompare(String(right.ingestSeq), undefined, {
      numeric: true,
    })
  }
}

// Batched ingest is not event order; the ingest sequence only breaks time ties.
const compareEventTime = (left: AgentEventRow, right: AgentEventRow) => {
  const difference = Date.parse(left.proxyCreatedAt) - Date.parse(right.proxyCreatedAt)
  return difference ? Math.sign(difference) : compareIngestSequence(left, right)
}

/** Rows oldest to newest by event time; the cap keeps the newest. */
export const mergeAgentEventRows = (
  current: AgentEventRow[],
  incoming: AgentEventRow[],
  maximum = 500
) => {
  const merged = new Map(current.map((event) => [eventKey(event), event]))
  incoming.forEach((event) => merged.set(eventKey(event), event))
  return [...merged.values()].sort(compareEventTime).slice(-maximum)
}

export const newestAgentEventSequence = (events: AgentEventRow[]) =>
  events.reduce<string>(
    (newest, event) =>
      compareIngestSequence(event, { ingestSeq: newest } as AgentEventRow) > 0
        ? String(event.ingestSeq)
        : newest,
    '0'
  )

export const agentEventKey = eventKey

export const blockedHostConnectionCandidates = (
  event: AgentEventRow,
  workflows: AgentEventWorkflow[]
): AgentEventConnectionCandidate[] => {
  if (
    event.eventType?.toLowerCase() !== 'request' ||
    event.protocol?.toLowerCase() !== 'http' ||
    event.proxyDecision?.toLowerCase() !== 'block' ||
    event.outcome?.toLowerCase() !== 'denied' ||
    event.reason?.toLowerCase() !== 'lockdown_unbound_host' ||
    !event.host?.trim() ||
    !Number.isInteger(event.port) ||
    Number(event.port) < 1 ||
    Number(event.port) > 65535 ||
    !event.workflow?.id ||
    event.connection != null
  )
    return []

  const workflow = workflows.find((candidate) => candidate.id === event.workflow?.id)
  if (!workflow) return []

  const uniqueConnections = [
    ...new Map(workflow.connections.map((connection) => [connection.id, connection])).values(),
  ].filter((connection) => connection.hostRulesVersion)

  return uniqueConnections
}

export const blockedHostConnectionCandidate = (
  event: AgentEventRow,
  workflows: AgentEventWorkflow[]
) => {
  const candidates = blockedHostConnectionCandidates(event, workflows)
  return candidates.length === 1 ? candidates[0] : null
}

export const agentEventAuthority = (event: Pick<AgentEventRow, 'host' | 'port'>) => {
  const host = event.host?.trim() || ''
  if (!host) return ''
  if (!Number.isInteger(event.port)) return host
  return `${host.includes(':') ? `[${host}]` : host}:${event.port}`
}

/**
 * Whether a member may add a host to Connections of this service from the log:
 * only a service whose host rules are an optional override takes one.
 */
export const agentConnectionTakesHostOverride = (
  serviceType: string,
  hostRulesModeByService: ReadonlyMap<string, string | null | undefined>
) => hostRulesModeByService.get(serviceType.toLowerCase()) === 'optional_override'

export const canAllowAgentConnectionHost = (
  canUpdateWorkflow: boolean,
  canManageConnectionHosts: boolean
) => canUpdateWorkflow && canManageConnectionHosts

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const titleCase = (value: string) =>
  `${value.charAt(0).toUpperCase()}${value.slice(1).replace(/_/g, ' ')}`

/** The rule in force, as the proxy recorded it, in words. Plain text only. */
export const describePolicyRule = (rule: unknown): string => {
  if (rule === 'default') return 'Default'
  if (rule === 'secret_guard') return 'Secret guard'
  if (typeof rule === 'string') return rule
  if (!isRecordValue(rule)) return ''
  const effect = typeof rule.effect === 'string' ? titleCase(rule.effect) : ''
  let target = ''
  if (typeof rule.class === 'string') target = `${titleCase(rule.class)} calls`
  else if (isRecordValue(rule.match)) {
    const methods = Array.isArray(rule.match.methods)
      ? rule.match.methods.filter((method): method is string => typeof method === 'string')
      : []
    target = [methods.join(', '), typeof rule.match.path === 'string' ? rule.match.path : '']
      .filter(Boolean)
      .join(' ')
  }
  return [target, effect].filter(Boolean).join(': ')
}

/**
 * The class of call and the rule behind a call the proxy blocked or held for
 * a request, when the event records them. Null for any other event.
 */
export const policyDecisionDetail = (
  event: Pick<AgentEventRow, 'proxyDecision' | 'detail'>
): { callClass: string; rule: string } | null => {
  const decision = event.proxyDecision?.toLowerCase()
  if (decision !== 'block' && decision !== 'ask') return null
  const detail = event.detail
  if (!isRecordValue(detail)) return null
  const callClass = typeof detail.class === 'string' ? titleCase(detail.class) : ''
  const rule = describePolicyRule(detail.rule)
  return callClass || rule ? { callClass, rule } : null
}
