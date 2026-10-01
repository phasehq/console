// Polyfill for jsdom environment
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val))
}

import {
  AGENT_PERMISSION_RESOURCES,
  arePoliciesEqual,
  parsePermissions,
  PermissionPolicy,
  permissionKeyFor,
  togglePolicyResourcePermission,
  updatePolicyResourcePermissions,
  userHasPermission,
} from '@/utils/access/permissions'

const policy = (overrides: Partial<PermissionPolicy> = {}): PermissionPolicy => ({
  permissions: {},
  app_permissions: {},
  agent_permissions: {},
  global_access: false,
  ...overrides,
})

describe('Agent permission namespace', () => {
  test('mirrors the backend resource set', () => {
    // Must match AGENT_PERMISSION_RESOURCES in backend/api/utils/access/roles.py.
    expect([...AGENT_PERMISSION_RESOURCES].sort()).toEqual([
      'AgentMemberships',
      'AgentSessions',
      'AgentTokens',
      'AgentWorkflows',
    ])
  })

  test.each([
    ['AgentWorkflows', false, 'agent_permissions'],
    ['AgentMemberships', false, 'agent_permissions'],
    ['AgentTokens', false, 'agent_permissions'],
    ['AgentSessions', false, 'agent_permissions'],
    // Lifecycle and org-wide assets stay organisation scoped, as Apps does.
    ['Agents', false, 'permissions'],
    ['AgentConnections', false, 'permissions'],
    ['AgentRequests', false, 'permissions'],
    // Colliding app/org names still need the explicit flag.
    ['Members', false, 'permissions'],
    ['Members', true, 'app_permissions'],
  ])('routes %s (isAppResource=%s) to %s', (resource, isAppResource, expected) => {
    expect(permissionKeyFor(resource as string, isAppResource as boolean)).toBe(expected)
  })

  test('reads Agent resources from agent_permissions', () => {
    const json = JSON.stringify(
      policy({
        permissions: { Agents: ['read'] },
        agent_permissions: { AgentWorkflows: ['update'] },
      })
    )

    expect(userHasPermission(json, 'Agents', 'read')).toBe(true)
    expect(userHasPermission(json, 'AgentWorkflows', 'update')).toBe(true)
    expect(userHasPermission(json, 'AgentWorkflows', 'delete')).toBe(false)
  })

  test('a grant left in the organisation map confers nothing', () => {
    const json = JSON.stringify({
      permissions: { AgentWorkflows: ['update'] },
      app_permissions: {},
    })

    expect(userHasPermission(json, 'AgentWorkflows', 'update')).toBe(false)
  })

  test('parsing keeps agent_permissions and defaults it when absent', () => {
    expect(
      parsePermissions(JSON.stringify(policy({ agent_permissions: { AgentTokens: ['read'] } })))
        ?.agent_permissions
    ).toEqual({ AgentTokens: ['read'] })
    expect(
      parsePermissions(JSON.stringify({ permissions: {}, app_permissions: {} }))?.agent_permissions
    ).toEqual({})
  })

  test('a change confined to agent_permissions makes policies unequal', () => {
    // Otherwise the role editor would never enable Save for an Agent-only edit.
    const before = policy({ agent_permissions: { AgentSessions: ['read'] } })
    const after = policy({ agent_permissions: { AgentSessions: ['read', 'delete'] } })

    expect(arePoliciesEqual(before, after)).toBe(false)
    expect(arePoliciesEqual(before, structuredClone(before))).toBe(true)
  })

  test('toggling an Agent resource writes to agent_permissions only', () => {
    const updated = togglePolicyResourcePermission(policy(), {
      resource: 'AgentTokens',
      action: 'create',
    })

    expect(updated.agent_permissions).toEqual({ AgentTokens: ['create'] })
    expect(updated.permissions).toEqual({})
  })

  test('applying a template to an Agent resource writes to agent_permissions only', () => {
    const updated = updatePolicyResourcePermissions(policy(), {
      resource: 'AgentMemberships',
      actions: ['create', 'read', 'update', 'delete'],
    })

    expect(updated.agent_permissions).toEqual({
      AgentMemberships: ['create', 'read', 'update', 'delete'],
    })
    expect(updated.permissions).toEqual({})
  })

  test('editing a role stored before agent_permissions existed still works', () => {
    // parsePermissions defaults the map, but a raw legacy object may lack it.
    const legacy = { permissions: {}, app_permissions: {}, global_access: false } as PermissionPolicy

    expect(
      togglePolicyResourcePermission(legacy, { resource: 'AgentWorkflows', action: 'read' })
        .agent_permissions
    ).toEqual({ AgentWorkflows: ['read'] })
  })
})
