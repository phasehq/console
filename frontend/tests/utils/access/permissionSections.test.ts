import {
  AGENT_PERMISSION_ACTIONS,
  AGENT_PERMISSION_RESOURCES,
  partitionOrganisationPermissions,
} from '@/utils/access/permissionSections'

describe('role permission sections', () => {
  test('groups only Agent-domain resources under Agent permissions', () => {
    const permissions = {
      Organisation: ['read'],
      IntegrationCredentials: ['create', 'read', 'update'],
      NetworkAccessPolicies: ['read'],
      ExternalIdentities: ['read'],
      Agents: ['read', 'create'],
      AgentWorkflows: ['read'],
      AgentMemberships: [],
      AgentTokens: ['read'],
      AgentConnections: ['read', 'update'],
      AgentRequests: ['create', 'read'],
      AgentSessions: ['create', 'read'],
    }

    const { organisationPermissions, agentPermissions } =
      partitionOrganisationPermissions(permissions)

    expect(Object.keys(agentPermissions)).toEqual(AGENT_PERMISSION_RESOURCES)
    expect(organisationPermissions).toEqual({
      Organisation: ['read'],
      IntegrationCredentials: ['create', 'read', 'update'],
      NetworkAccessPolicies: ['read'],
      ExternalIdentities: ['read'],
    })
    expect(permissions).toHaveProperty('Agents')
    expect(permissions).toHaveProperty('IntegrationCredentials')
  })

  test('keeps Agent permissions in the standard CRUD model', () => {
    expect(AGENT_PERMISSION_ACTIONS).toEqual(['read', 'create', 'update', 'delete'])
  })
})
