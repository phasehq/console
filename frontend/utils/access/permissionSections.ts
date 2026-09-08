export const AGENT_PERMISSION_RESOURCES = [
  'Agents',
  'AgentTokens',
  'AgentConnections',
  'AgentRequests',
] as const

const agentPermissionResources = new Set<string>(AGENT_PERMISSION_RESOURCES)

export const ORGANISATION_PERMISSION_ACTIONS = ['read', 'create', 'update', 'delete'] as const
export const AGENT_PERMISSION_ACTIONS = [...ORGANISATION_PERMISSION_ACTIONS, 'execute'] as const

/**
 * Agent resources remain in the backend's organisation permission namespace.
 * This partition controls presentation only, preserving stored role policies.
 */
export const partitionOrganisationPermissions = <T>(permissions: Record<string, T>) => {
  const organisationPermissions: Record<string, T> = {}
  const agentPermissions: Record<string, T> = {}

  Object.entries(permissions).forEach(([resource, actions]) => {
    const section = agentPermissionResources.has(resource)
      ? agentPermissions
      : organisationPermissions
    section[resource] = actions
  })

  return { organisationPermissions, agentPermissions }
}
