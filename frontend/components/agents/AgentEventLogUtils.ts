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

export const mergeAgentEventRows = (
  current: AgentEventRow[],
  incoming: AgentEventRow[],
  maximum = 500
) => {
  const merged = new Map(current.map((event) => [eventKey(event), event]))
  incoming.forEach((event) => merged.set(eventKey(event), event))
  return [...merged.values()].sort(compareIngestSequence).slice(-maximum)
}

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

export const agentConnectionUsesHTTP = (
  serviceType: string,
  httpServiceTypes: ReadonlySet<string>
) => httpServiceTypes.has(serviceType.toLowerCase())

export const canAllowAgentConnectionHost = (
  canUpdateAgent: boolean,
  canManageConnectionHosts: boolean
) => canUpdateAgent && canManageConnectionHosts
