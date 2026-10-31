import {
  agentWordLabel,
  isAgentRequestPending,
  normalizeAgentEnum,
  sortAgentWorkflows,
} from './AgentEnums'

/** Pure model-building helpers for the Agent, Workflow, and Connection canvas. */
export type MeshAgentInput = {
  id: string
  name: string
  harnessType: string
  status: string
  lastSeenAt?: string | null
  activeSessionCount: number
  canMintToken: boolean
}

export type MeshAuthenticationInput = {
  id?: string
  name: string
  provider?: { id?: string; name: string } | null
}

export type MeshConnectionReference = {
  id: string
  name: string
  serviceType: string
  state?: string | null
  authentication?: MeshAuthenticationInput | null
}

export type MeshGrantInput = {
  id?: string
  connection: MeshConnectionReference
}

export type MeshWorkflowInput = {
  id: string
  name: string
  agentId: string
  createdAt?: string | null
  grants: MeshGrantInput[]
}

export type MeshConnectionInput = MeshConnectionReference

export type MeshRequestInput = {
  id: string
  kind: string
  status: string
  serviceType?: string | null
  credentialProvider?: string | null
  credentialName?: string | null
  createdAt: string
  expiresAt?: string | null
  agent: { id: string; name?: string }
  workflow?: { id: string; name: string } | null
  connection?: { id: string; name: string; serviceType?: string | null } | null
}

export type MeshRequestChip = {
  id: string
  kind: string
  workflowId: string | null
  connectionId: string | null
  workflowName: string
  targetLabel: string
  createdAt: string
  expiresAt: string | null
}

export type MeshWorkflowNode = {
  id: string
  name: string
  grantCount: number
}

export type MeshAgentNode = MeshAgentInput & {
  workflows: MeshWorkflowNode[]
  pendingRequests: MeshRequestChip[]
}

export type MeshConnectionNode = MeshConnectionReference & {
  workflowCount: number
  fromGrantOnly: boolean
}

export type MeshEdge = {
  key: string
  fromKey: string
  toKey: string
  kind: 'grant'
  grantCount: number
  dashed: false
}

export type MeshModel = {
  agents: MeshAgentNode[]
  connections: MeshConnectionNode[]
  edges: MeshEdge[]
}

export const meshNodeKey = {
  agent: (id: string) => `agent:${id}`,
  workflow: (id: string) => `workflow:${id}`,
  connection: (id: string) => `connection:${id}`,
  request: (id: string) => `request:${id}`,
}

const byName = <T extends { id: string; name: string }>(left: T, right: T) =>
  left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) ||
  left.id.localeCompare(right.id)

// Requests without a deadline sort after those with one.
const requestDeadline = (request: MeshRequestChip) => {
  const deadline = Date.parse(request.expiresAt || '')
  return Number.isNaN(deadline) ? Number.POSITIVE_INFINITY : deadline
}

export const meshHumanize = (value: string) =>
  value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(agentWordLabel)
    .join(' ')

export const meshServiceLabel = (serviceType: string) => meshHumanize(serviceType)

export const meshRequestTargetLabel = (request: MeshRequestInput) => {
  if (request.connection?.name) return request.connection.name
  if (request.credentialName) return request.credentialName
  if (request.credentialProvider) return meshServiceLabel(request.credentialProvider)
  if (request.serviceType) return meshServiceLabel(request.serviceType)
  return 'Connection credentials'
}

export const meshRelativeAge = (
  createdAt: string,
  now: number,
  style: 'short' | 'long' = 'short'
) => {
  const created = new Date(createdAt).valueOf()
  if (Number.isNaN(created)) return ''
  const seconds = Math.max(0, Math.floor((now - created) / 1000))
  if (seconds < 60) return 'just now'
  const unit = (count: number, shortSuffix: string, longNoun: string) =>
    style === 'short'
      ? `${count}${shortSuffix} ago`
      : `${count} ${longNoun}${count === 1 ? '' : 's'} ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return unit(minutes, 'm', 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return unit(hours, 'h', 'hour')
  return unit(Math.floor(hours / 24), 'd', 'day')
}

export function buildMeshModel({
  agents,
  workflows,
  connections = [],
  requests = [],
}: {
  agents: MeshAgentInput[]
  workflows: MeshWorkflowInput[]
  connections?: MeshConnectionInput[]
  requests?: MeshRequestInput[]
}): MeshModel {
  const workflowsByAgent = new Map<string, MeshWorkflowInput[]>()
  for (const workflow of workflows) {
    workflowsByAgent.set(workflow.agentId, [
      ...(workflowsByAgent.get(workflow.agentId) || []),
      workflow,
    ])
  }

  const pendingByAgent = new Map<string, MeshRequestChip[]>()
  for (const request of requests.filter((request) => isAgentRequestPending(request.status))) {
    pendingByAgent.set(request.agent.id, [
      ...(pendingByAgent.get(request.agent.id) || []),
      {
        id: request.id,
        kind: normalizeAgentEnum(request.kind),
        workflowId: request.workflow?.id || null,
        connectionId: request.connection?.id || null,
        workflowName: request.workflow?.name || 'Unknown workflow',
        targetLabel: meshRequestTargetLabel(request),
        createdAt: request.createdAt,
        expiresAt: request.expiresAt || null,
      },
    ])
  }

  const agentNodes: MeshAgentNode[] = [...agents].sort(byName).map((agent) => ({
    ...agent,
    workflows: sortAgentWorkflows(workflowsByAgent.get(agent.id) || []).map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      grantCount: workflow.grants.length,
    })),
    // The request closest to expiring leads, since each one has a limited window.
    pendingRequests: (pendingByAgent.get(agent.id) || []).sort(
      (left, right) =>
        requestDeadline(left) - requestDeadline(right) ||
        new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf() ||
        left.id.localeCompare(right.id)
    ),
  }))

  const grants = workflows.flatMap((workflow) => workflow.grants)
  const connectionById = new Map<string, MeshConnectionNode>()
  for (const connection of connections) {
    connectionById.set(connection.id, {
      ...connection,
      workflowCount: 0,
      fromGrantOnly: false,
    })
  }
  for (const grant of grants) {
    if (!connectionById.has(grant.connection.id)) {
      connectionById.set(grant.connection.id, {
        ...grant.connection,
        workflowCount: 0,
        fromGrantOnly: true,
      })
    }
  }

  const edges: MeshEdge[] = []
  for (const workflow of workflows) {
    const counts = new Map<string, number>()
    for (const grant of workflow.grants) {
      counts.set(grant.connection.id, (counts.get(grant.connection.id) || 0) + 1)
    }
    for (const [connectionId, grantCount] of counts) {
      edges.push({
        key: `grant:${workflow.id}:${connectionId}`,
        fromKey: meshNodeKey.workflow(workflow.id),
        toKey: meshNodeKey.connection(connectionId),
        kind: 'grant',
        grantCount,
        dashed: false,
      })
    }
  }

  for (const connection of connectionById.values()) {
    connection.workflowCount = new Set(
      workflows
        .filter((workflow) =>
          workflow.grants.some((grant) => grant.connection.id === connection.id)
        )
        .map((workflow) => workflow.id)
    ).size
  }

  return {
    agents: agentNodes,
    connections: [...connectionById.values()].sort(byName),
    edges,
  }
}

/** The node and its direct neighbours; shared Connections don't light other Agents. */
export function meshFocusKeys(model: MeshModel, focusKey: string): Set<string> {
  const agentByWorkflow = new Map<string, string>()
  const workflowsByAgent = new Map<string, string[]>()
  for (const agent of model.agents) {
    const agentKey = meshNodeKey.agent(agent.id)
    const workflowKeys = agent.workflows.map((workflow) => meshNodeKey.workflow(workflow.id))
    workflowsByAgent.set(agentKey, workflowKeys)
    for (const workflowKey of workflowKeys) agentByWorkflow.set(workflowKey, agentKey)
  }

  for (const agent of model.agents) {
    const request = agent.pendingRequests.find(({ id }) => meshNodeKey.request(id) === focusKey)
    if (!request) continue
    const keys = new Set([focusKey, meshNodeKey.agent(agent.id)])
    if (request.workflowId) keys.add(meshNodeKey.workflow(request.workflowId))
    if (request.connectionId) {
      const connectionKey = meshNodeKey.connection(request.connectionId)
      keys.add(connectionKey)
      // New credentials apply to every Workflow granted the Connection, so show them all.
      if (request.kind === 'CREDENTIAL_UPDATE') {
        for (const edge of model.edges.filter(({ toKey }) => toKey === connectionKey)) {
          keys.add(edge.fromKey)
          const agentKey = agentByWorkflow.get(edge.fromKey)
          if (agentKey) keys.add(agentKey)
        }
      }
    }
    return keys
  }

  const keys = new Set([focusKey])
  const ownerKey = agentByWorkflow.get(focusKey)
  if (ownerKey) keys.add(ownerKey)
  const sources = new Set(workflowsByAgent.get(focusKey) ?? (ownerKey ? [focusKey] : []))
  sources.forEach((key) => keys.add(key))
  for (const edge of model.edges) {
    if (sources.has(edge.fromKey)) keys.add(edge.toKey)
    if (edge.toKey === focusKey) {
      keys.add(edge.fromKey)
      const agentKey = agentByWorkflow.get(edge.fromKey)
      if (agentKey) keys.add(agentKey)
    }
  }
  for (const agent of model.agents) {
    for (const request of agent.pendingRequests) {
      if (!request.workflowId) continue
      const workflowKey = meshNodeKey.workflow(request.workflowId)
      const connectionKey = request.connectionId && meshNodeKey.connection(request.connectionId)
      if (sources.has(workflowKey)) {
        keys.add(meshNodeKey.request(request.id))
        if (connectionKey) keys.add(connectionKey)
      } else if (connectionKey === focusKey) {
        keys.add(meshNodeKey.request(request.id))
        keys.add(workflowKey)
        keys.add(meshNodeKey.agent(agent.id))
      }
    }
  }
  return keys
}

const includes = (value: string | null | undefined, query: string) =>
  value?.toLowerCase().includes(query) || false

export function filterMeshModel(model: MeshModel, query: string): MeshModel {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return model

  const agents = model.agents.filter(
    (agent) =>
      includes(agent.name, normalized) ||
      includes(agent.harnessType, normalized) ||
      agent.workflows.some((workflow) => includes(workflow.name, normalized)) ||
      agent.pendingRequests.some(
        (request) =>
          includes(request.workflowName, normalized) || includes(request.targetLabel, normalized)
      )
  )
  const connections = model.connections.filter(
    (connection) =>
      includes(connection.name, normalized) ||
      includes(meshServiceLabel(connection.serviceType), normalized) ||
      includes(connection.state, normalized) ||
      includes(connection.authentication?.name, normalized) ||
      includes(connection.authentication?.provider?.name, normalized)
  )
  const visibleKeys = new Set([
    ...agents.flatMap((agent) => [
      meshNodeKey.agent(agent.id),
      ...agent.workflows.map((workflow) => meshNodeKey.workflow(workflow.id)),
    ]),
    ...connections.map((connection) => meshNodeKey.connection(connection.id)),
  ])

  return {
    agents,
    connections,
    edges: model.edges.filter(
      (edge) => visibleKeys.has(edge.fromKey) && visibleKeys.has(edge.toKey)
    ),
  }
}

export const meshPendingRequestCount = (model: MeshModel) =>
  model.agents.reduce((count, agent) => count + agent.pendingRequests.length, 0)

/** Agents with pending requests, and the Connections they use or ask for. */
export function pendingMeshModel(model: MeshModel): MeshModel {
  const agents = model.agents.filter((agent) => agent.pendingRequests.length > 0)
  const workflowKeys = new Set(
    agents.flatMap((agent) => agent.workflows.map((workflow) => meshNodeKey.workflow(workflow.id)))
  )
  const edges = model.edges.filter((edge) => workflowKeys.has(edge.fromKey))
  const connectionKeys = new Set([
    ...edges.map((edge) => edge.toKey),
    ...agents.flatMap((agent) =>
      agent.pendingRequests.flatMap(({ connectionId }) =>
        connectionId ? [meshNodeKey.connection(connectionId)] : []
      )
    ),
  ])
  return {
    agents,
    connections: model.connections.filter((connection) =>
      connectionKeys.has(meshNodeKey.connection(connection.id))
    ),
    edges,
  }
}

export type MeshPoint = { x: number; y: number }

export const meshEdgePath = (from: MeshPoint, to: MeshPoint) => {
  const distance = Math.abs(to.x - from.x)
  const bend = Math.min(96, Math.max(32, distance * 0.48))
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`
}
