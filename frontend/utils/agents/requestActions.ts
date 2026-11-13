/**
 * The typed action an Agent request can carry, as the Console reads it.
 *
 * Everything on a request is data an Agent wrote or the server derived from
 * it, so each reader here checks shapes instead of trusting them.
 */

import { parseHttpDefinition, type HttpDefinition } from '@/utils/agents/httpDefinition'

export const REQUEST_ACTION_VERSION = 1

export const REQUEST_ACTION_TYPES = {
  create: 'agent_connection.create',
  update: 'agent_connection.update',
  secretUpdate: 'agent_connection.secret_update',
  remove: 'agent_connection.remove',
} as const

export type RequestActionType = (typeof REQUEST_ACTION_TYPES)[keyof typeof REQUEST_ACTION_TYPES]

export type ReviewSnapshot = { name: string; definition: HttpDefinition | null }

export type ActionReview = {
  type: RequestActionType
  title: string
  requiresSecret: boolean
  current: ReviewSnapshot | null
  proposed: ReviewSnapshot | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const KNOWN_TYPES = new Set<string>(Object.values(REQUEST_ACTION_TYPES))

export const requestActionType = (action: unknown): RequestActionType | null =>
  isRecord(action) && typeof action.type === 'string' && KNOWN_TYPES.has(action.type)
    ? (action.type as RequestActionType)
    : null

const readSnapshot = (value: unknown): ReviewSnapshot | null =>
  isRecord(value)
    ? {
        name: typeof value.name === 'string' ? value.name : '',
        definition: parseHttpDefinition(value.definition),
      }
    : null

/** The server's review of a request's action, or null when it gives none. */
export const readActionReview = (value: unknown): ActionReview | null => {
  if (!isRecord(value)) return null
  const type = requestActionType(value)
  if (!type) return null
  return {
    type,
    title: typeof value.title === 'string' ? value.title : '',
    requiresSecret: value.requiresSecret === true,
    current: readSnapshot(value.current),
    proposed: readSnapshot(value.proposed),
  }
}

/** What an action as filed or as applied proposes, for a summary. */
export const readActionSnapshot = (action: unknown): ReviewSnapshot | null =>
  isRecord(action) && (action.name !== undefined || action.definition !== undefined)
    ? readSnapshot(action)
    : null

/** The AgentConnections permission approving an action takes, if any. */
export const requestActionPermission = (type: RequestActionType): 'create' | 'update' | null =>
  type === REQUEST_ACTION_TYPES.create
    ? 'create'
    : type === REQUEST_ACTION_TYPES.remove
      ? null
      : 'update'

/**
 * The action a reviewer approves after editing the proposal. It keeps the
 * type and the Connection the proposal named; only the name and definition
 * are the reviewer's.
 */
export const editedRequestAction = (
  original: unknown,
  name: string,
  definition: HttpDefinition
): Record<string, unknown> | null => {
  const type = requestActionType(original)
  if (!type || !isRecord(original)) return null
  if (type === REQUEST_ACTION_TYPES.create)
    return {
      type,
      version: REQUEST_ACTION_VERSION,
      serviceType: 'http',
      name,
      definition,
    }
  if (type === REQUEST_ACTION_TYPES.update)
    return {
      type,
      version: REQUEST_ACTION_VERSION,
      connectionId: original.connectionId,
      name,
      definition,
    }
  return null
}

/** How a request was approved, in words. Stored as data so stronger levels can follow. */
export const approvalLabel = (approval: unknown): string => {
  if (!isRecord(approval) || typeof approval.assurance !== 'string') return ''
  if (approval.assurance === 'session') return 'a signed-in Console session'
  return approval.assurance.replace(/_/g, ' ')
}
