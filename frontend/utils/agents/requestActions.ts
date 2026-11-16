/**
 * The typed action a change request can carry, as the Console reads it.
 *
 * Everything on a request is data an Agent wrote or the server derived from
 * it, so each reader here checks shapes instead of trusting them.
 */

import { parseHttpDefinition, type HttpDefinition } from '@/utils/agents/httpDefinition'
import {
  AWS_ACTION_FORMAT,
  OPERATION_CLASSES,
  readPolicy,
  readTemporaryAllows,
  type AccessPolicy,
  type OperationClass,
  type PolicyMatch,
  type TemporaryAllow,
} from '@/utils/agents/accessPolicy'

export const REQUEST_ACTION_VERSION = 1

export const REQUEST_ACTION_TYPES = {
  create: 'agent_connection.create',
  update: 'agent_connection.update',
  secretUpdate: 'agent_connection.secret_update',
  remove: 'agent_connection.remove',
  allow: 'agent_grant.allow',
  renew: 'agent_grant.renew',
  contextUpdate: 'agent_workflow.context_update',
} as const

export type RequestActionType = (typeof REQUEST_ACTION_TYPES)[keyof typeof REQUEST_ACTION_TYPES]

export type ReviewSnapshot = {
  name: string
  definition: HttpDefinition | null
  /** How long a new Connection's access was asked to last. */
  durationSeconds?: number
}

/** What an allow request would add: a class, an exact call, or one exact AWS action. */
export type AllowTarget = { class?: OperationClass; match?: PolicyMatch; operation?: string }

export type BlockedCall = {
  method: string
  host: string
  path: string
  class: string
  /** The AWS action of the call, when the proxy could name it. */
  operation: string
}

export type AllowReview = {
  connectionName: string
  policy: AccessPolicy | null
  temporaryAllows: TemporaryAllow[]
  allow: AllowTarget
  blockedCall: BlockedCall | null
  durationSeconds: number | null
}

export type RenewReview = {
  connectionName: string
  state: 'active' | 'expired' | 'revoked' | 'none'
  expiresAt: string | null
  durationSeconds: number | null
}

export type ContextReview = { current: string; requested: string }

export type ActionReview = {
  type: RequestActionType
  title: string
  requiresSecret: boolean
  current: ReviewSnapshot | null
  requested: ReviewSnapshot | null
  allow?: AllowReview
  renew?: RenewReview
  context?: ContextReview
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
        ...(typeof value.durationSeconds === 'number'
          ? { durationSeconds: value.durationSeconds }
          : {}),
      }
    : null

const seconds = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export const readAllowTarget = (value: unknown): AllowTarget => {
  if (!isRecord(value)) return {}
  if (typeof value.operation === 'string')
    return AWS_ACTION_FORMAT.test(value.operation) ? { operation: value.operation } : {}
  if (
    typeof value.class === 'string' &&
    (OPERATION_CLASSES as readonly string[]).includes(value.class)
  )
    return { class: value.class as OperationClass }
  if (isRecord(value.match)) {
    const match: PolicyMatch = {}
    if (Array.isArray(value.match.methods))
      match.methods = value.match.methods.filter(
        (method): method is string => typeof method === 'string'
      )
    if (typeof value.match.path === 'string') match.path = value.match.path
    return { match }
  }
  return {}
}

/** The call an Agent was refused, as it described it. Shown as text only. */
export const readBlockedCall = (value: unknown): BlockedCall | null => {
  if (!isRecord(value)) return null
  const text = (field: unknown) => (typeof field === 'string' ? field : '')
  return {
    method: text(value.method),
    host: text(value.host),
    path: text(value.path),
    class: text(value.class),
    operation: text(value.operation),
  }
}

const readAllowReview = (value: Record<string, unknown>): AllowReview => {
  const current = isRecord(value.current) ? value.current : null
  const requested = isRecord(value.requested) ? value.requested : {}
  return {
    connectionName: current && typeof current.name === 'string' ? current.name : '',
    policy: current ? readPolicy(current.policy) : null,
    temporaryAllows: current ? readTemporaryAllows(current.temporaryAllows) : [],
    allow: readAllowTarget(requested.allow),
    blockedCall: readBlockedCall(requested.blockedCall),
    durationSeconds: seconds(requested.durationSeconds),
  }
}

const RENEW_STATES = ['active', 'expired', 'revoked', 'none'] as const

const readRenewReview = (value: Record<string, unknown>): RenewReview => {
  const current = isRecord(value.current) ? value.current : null
  const requested = isRecord(value.requested) ? value.requested : {}
  const state = current?.state
  return {
    connectionName: current && typeof current.name === 'string' ? current.name : '',
    state: (RENEW_STATES as readonly unknown[]).includes(state)
      ? (state as RenewReview['state'])
      : 'none',
    expiresAt: current && typeof current.expiresAt === 'string' ? current.expiresAt : null,
    durationSeconds: seconds(requested.durationSeconds),
  }
}

const readContextReview = (value: Record<string, unknown>): ContextReview => {
  const text = (side: unknown) =>
    isRecord(side) && typeof side.markdown === 'string' ? side.markdown : ''
  return { current: text(value.current), requested: text(value.requested) }
}

/** What a request was asked for and what was granted, once approved. */
export type AccessRecord = {
  requestedSeconds: number | null
  grantedSeconds: number | null
  expiresAt: string | null
}

export const readAccessRecord = (value: unknown): AccessRecord | null =>
  isRecord(value)
    ? {
        requestedSeconds: seconds(value.requestedDurationSeconds),
        grantedSeconds: seconds(value.grantedDurationSeconds),
        expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : null,
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
    requested: readSnapshot(value.requested),
    ...(type === REQUEST_ACTION_TYPES.allow ? { allow: readAllowReview(value) } : {}),
    ...(type === REQUEST_ACTION_TYPES.renew ? { renew: readRenewReview(value) } : {}),
    ...(type === REQUEST_ACTION_TYPES.contextUpdate ? { context: readContextReview(value) } : {}),
  }
}

/** What an action as filed or as applied asks for, for a summary. */
export const readActionSnapshot = (action: unknown): ReviewSnapshot | null =>
  isRecord(action) && (action.name !== undefined || action.definition !== undefined)
    ? readSnapshot(action)
    : null

/** The AgentConnections permission approving an action takes, if any. */
export const requestActionPermission = (
  type: RequestActionType
): 'create' | 'update' | 'read' | null => {
  switch (type) {
    case REQUEST_ACTION_TYPES.create:
      return 'create'
    case REQUEST_ACTION_TYPES.remove:
    case REQUEST_ACTION_TYPES.contextUpdate:
      return null
    case REQUEST_ACTION_TYPES.allow:
    case REQUEST_ACTION_TYPES.renew:
      return 'read'
    default:
      return 'update'
  }
}

/** Whether an approval for this action may be left without an end. A temporary allow always ends. */
export const actionAllowsUntilRevoked = (type: RequestActionType | null | undefined): boolean =>
  type !== REQUEST_ACTION_TYPES.allow

/** Whether the action ends in access that lasts for a time. */
export const actionTakesDuration = (type: RequestActionType | null | undefined): boolean =>
  type === REQUEST_ACTION_TYPES.create ||
  type === REQUEST_ACTION_TYPES.allow ||
  type === REQUEST_ACTION_TYPES.renew

/**
 * The allow a reviewer approves after narrowing it. It keeps the Connection
 * and the call the request named; only the rule is the reviewer's.
 */
export const editedAllowAction = (
  original: unknown,
  allow: AllowTarget
): Record<string, unknown> | null => {
  if (requestActionType(original) !== REQUEST_ACTION_TYPES.allow || !isRecord(original)) return null
  return {
    type: REQUEST_ACTION_TYPES.allow,
    version: REQUEST_ACTION_VERSION,
    connectionId: original.connectionId,
    allow,
    ...(original.blockedCall !== undefined && original.blockedCall !== null
      ? { blockedCall: original.blockedCall }
      : {}),
  }
}

/** The context a reviewer approves after editing the requested text. */
export const editedContextAction = (
  original: unknown,
  markdown: string
): Record<string, unknown> | null =>
  requestActionType(original) === REQUEST_ACTION_TYPES.contextUpdate
    ? { type: REQUEST_ACTION_TYPES.contextUpdate, version: REQUEST_ACTION_VERSION, markdown }
    : null

/**
 * The action a reviewer approves after editing the request. It keeps the
 * type and the Connection the request named; only the name and definition
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

// --- Narrowing an allow ---------------------------------------------------

export type AllowDraft = {
  scope: 'class' | 'match' | 'operation'
  class: OperationClass | ''
  methods: string[]
  path: string
  /** An AWS action; the reviewer may only swap it for another exact one. */
  operation: string
}

/**
 * The reviewer's starting point: the rule the request asked for. A request
 * for a whole class can be narrowed to the one call that was refused.
 */
export const allowDraftFromTarget = (
  target: AllowTarget,
  blocked: BlockedCall | null
): AllowDraft => {
  if (target.operation)
    return { scope: 'operation', class: '', methods: [], path: '', operation: target.operation }
  if (target.class)
    return {
      operation: '',
      scope: 'class',
      class: target.class,
      methods: blocked?.method ? [blocked.method.toUpperCase()] : [],
      path: blocked?.path ?? '',
    }
  return {
    operation: '',
    scope: 'match',
    class: (blocked?.class && (OPERATION_CLASSES as readonly string[]).includes(blocked.class)
      ? blocked.class
      : '') as OperationClass | '',
    methods: [...(target.match?.methods ?? [])],
    path: target.match?.path ?? '',
  }
}

/** The rule an allow draft stands for, or null while it is incomplete. */
export const allowFromDraft = (draft: AllowDraft): AllowTarget | null => {
  if (draft.scope === 'operation') {
    const operation = draft.operation.trim()
    return operation ? { operation } : null
  }
  if (draft.scope === 'class') return draft.class ? { class: draft.class } : null
  const match: PolicyMatch = {}
  if (draft.methods.length > 0) match.methods = draft.methods
  const path = draft.path.trim()
  if (path) match.path = path
  return match.methods || match.path ? { match } : null
}

export const allowDraftProblem = (draft: AllowDraft): string => {
  if (draft.scope === 'operation') {
    const operation = draft.operation.trim()
    if (!operation) return 'Enter an AWS action such as ec2:TerminateInstances.'
    return AWS_ACTION_FORMAT.test(operation)
      ? ''
      : 'Write one exact action as service:Action, with no wildcards.'
  }
  if (draft.scope === 'class') return draft.class ? '' : 'Choose a class of calls.'
  const path = draft.path.trim()
  if (draft.methods.length === 0 && !path) return 'Choose a method or enter a path.'
  if (path && !path.startsWith('/')) return 'A path begins with "/".'
  if (path.length > 1024) return 'Use at most 1024 characters in a path.'
  return ''
}

/** Whether the reviewer's rule differs from the requested one. */
export const allowEdited = (original: AllowTarget, edited: AllowTarget | null): boolean => {
  const normal = (target: AllowTarget | null) =>
    JSON.stringify(
      target?.operation
        ? { operation: target.operation }
        : target?.class
          ? { class: target.class }
          : target?.match
            ? { methods: [...(target.match.methods ?? [])].sort(), path: target.match.path ?? '' }
            : null
    )
  return normal(original) !== normal(edited)
}
