/** Canonicalize enum-like strings returned through GraphQL String fields. */
export const normalizeAgentEnum = (value?: string | null) => value?.trim().toUpperCase() || ''

export const isAgentActive = (status?: string | null) => normalizeAgentEnum(status) === 'ACTIVE'

export const isAgentRequestPending = (status?: string | null) =>
  normalizeAgentEnum(status) === 'PENDING'
