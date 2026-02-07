// Polyfill for jsdom environment
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val))
}

import {
  parsePermissions,
  userHasPermission,
  userHasGlobalAccess,
  userIsAdmin,
  arePoliciesEqual,
  togglePolicyResourcePermission,
  PermissionPolicy,
} from '@/utils/access/permissions'

describe('Ownership Transfer - Permission Prerequisite Tests', () => {
  describe('userHasGlobalAccess', () => {
    test('returns true for admin-level permissions with global_access', () => {
      const adminPermissions = JSON.stringify({
        permissions: { Members: ['read', 'create', 'delete'] },
        app_permissions: { Secrets: ['read', 'create'] },
        global_access: true,
      })
      expect(userHasGlobalAccess(adminPermissions)).toBe(true)
    })

    test('returns false for developer-level permissions without global_access', () => {
      const devPermissions = JSON.stringify({
        permissions: { Apps: ['read'] },
        app_permissions: { Secrets: ['read', 'create'] },
        global_access: false,
      })
      expect(userHasGlobalAccess(devPermissions)).toBe(false)
    })

    test('returns false for empty permissions JSON', () => {
      const emptyPermissions = JSON.stringify({})
      expect(userHasGlobalAccess(emptyPermissions)).toBe(false)
    })

    test('returns false for invalid JSON string', () => {
      expect(userHasGlobalAccess('invalid-json')).toBe(false)
    })

    test('returns false for empty string', () => {
      expect(userHasGlobalAccess('')).toBe(false)
    })

    test('returns false when global_access key is missing', () => {
      const noGlobalAccess = JSON.stringify({
        permissions: { Members: ['read'] },
        app_permissions: {},
      })
      expect(userHasGlobalAccess(noGlobalAccess)).toBe(false)
    })

    test('returns true for owner-level permissions', () => {
      const ownerPermissions = JSON.stringify({
        permissions: {
          Apps: ['create', 'read', 'update', 'delete'],
          Members: ['create', 'read', 'update', 'delete'],
          Roles: ['create', 'read', 'update', 'delete'],
          Integrations: ['create', 'read', 'update', 'delete'],
          Organisation: ['read', 'update', 'delete'],
          Billing: ['read', 'update'],
        },
        app_permissions: {
          Secrets: ['create', 'read', 'update', 'delete'],
          Environments: ['create', 'read', 'update', 'delete'],
        },
        global_access: true,
      })
      expect(userHasGlobalAccess(ownerPermissions)).toBe(true)
    })

    test('returns false for custom role without global_access', () => {
      const customRole = JSON.stringify({
        permissions: {
          Apps: ['read'],
          Members: ['read'],
        },
        app_permissions: {
          Secrets: ['read'],
        },
        global_access: false,
      })
      expect(userHasGlobalAccess(customRole)).toBe(false)
    })

    test('returns true for custom role with global_access enabled', () => {
      const customGlobalRole = JSON.stringify({
        permissions: {
          Apps: ['read'],
        },
        app_permissions: {},
        global_access: true,
      })
      expect(userHasGlobalAccess(customGlobalRole)).toBe(true)
    })
  })

  describe('userIsAdmin', () => {
    test('admin role is recognized', () => {
      expect(userIsAdmin('admin')).toBe(true)
    })

    test('owner role is recognized as admin-level', () => {
      expect(userIsAdmin('owner')).toBe(true)
    })

    test('developer role is not admin', () => {
      expect(userIsAdmin('developer')).toBe(false)
    })

    test('manager role is not admin', () => {
      expect(userIsAdmin('manager')).toBe(false)
    })

    test('case insensitive matching', () => {
      expect(userIsAdmin('Admin')).toBe(true)
      expect(userIsAdmin('ADMIN')).toBe(true)
      expect(userIsAdmin('Owner')).toBe(true)
      expect(userIsAdmin('OWNER')).toBe(true)
    })

    test('service role is not admin', () => {
      expect(userIsAdmin('service')).toBe(false)
    })
  })

  describe('userHasPermission - Organisation permissions', () => {
    const adminPermissions = JSON.stringify({
      permissions: {
        Organisation: ['read', 'update', 'delete'],
        Members: ['read', 'create', 'update', 'delete'],
        Apps: ['create', 'read', 'update', 'delete'],
      },
      app_permissions: {
        Secrets: ['create', 'read', 'update', 'delete'],
      },
      global_access: true,
    })

    test('admin can read Organisation', () => {
      expect(userHasPermission(adminPermissions, 'Organisation', 'read')).toBe(true)
    })

    test('admin can update Organisation', () => {
      expect(userHasPermission(adminPermissions, 'Organisation', 'update')).toBe(true)
    })

    test('admin can manage Members', () => {
      expect(userHasPermission(adminPermissions, 'Members', 'create')).toBe(true)
      expect(userHasPermission(adminPermissions, 'Members', 'delete')).toBe(true)
    })

    const devPermissions = JSON.stringify({
      permissions: {
        Apps: ['read'],
      },
      app_permissions: {
        Secrets: ['create', 'read', 'update', 'delete'],
      },
      global_access: false,
    })

    test('developer cannot manage Organisation', () => {
      expect(userHasPermission(devPermissions, 'Organisation', 'update')).toBe(false)
    })

    test('developer cannot manage Members', () => {
      expect(userHasPermission(devPermissions, 'Members', 'create')).toBe(false)
    })
  })
})

describe('parsePermissions', () => {
  test('parses valid JSON with all fields', () => {
    const json = JSON.stringify({
      permissions: { Apps: ['read'] },
      app_permissions: { Secrets: ['read'] },
      global_access: true,
    })
    const result = parsePermissions(json)
    expect(result).toEqual({
      permissions: { Apps: ['read'] },
      app_permissions: { Secrets: ['read'] },
      global_access: true,
    })
  })

  test('handles missing fields with defaults', () => {
    const json = JSON.stringify({})
    const result = parsePermissions(json)
    expect(result).toEqual({
      permissions: {},
      app_permissions: {},
      global_access: false,
    })
  })

  test('strips extra keys', () => {
    const json = JSON.stringify({
      permissions: {},
      app_permissions: {},
      global_access: true,
      extra_key: 'should be ignored',
    })
    const result = parsePermissions(json)
    expect(result).not.toHaveProperty('extra_key')
    expect(result?.global_access).toBe(true)
  })

  test('returns null for invalid JSON', () => {
    expect(parsePermissions('not-json')).toBeNull()
    expect(parsePermissions('')).toBeNull()
  })
})

describe('togglePolicyResourcePermission - global_access toggle', () => {
  test('toggles global_access from false to true', () => {
    const policy: PermissionPolicy = {
      permissions: {},
      app_permissions: {},
      global_access: false,
    }
    const updated = togglePolicyResourcePermission(policy, { toggleGlobalAccess: true })
    expect(updated.global_access).toBe(true)
  })

  test('toggles global_access from true to false', () => {
    const policy: PermissionPolicy = {
      permissions: {},
      app_permissions: {},
      global_access: true,
    }
    const updated = togglePolicyResourcePermission(policy, { toggleGlobalAccess: true })
    expect(updated.global_access).toBe(false)
  })

  test('does not mutate original policy', () => {
    const policy: PermissionPolicy = {
      permissions: {},
      app_permissions: {},
      global_access: false,
    }
    togglePolicyResourcePermission(policy, { toggleGlobalAccess: true })
    expect(policy.global_access).toBe(false)
  })
})

describe('arePoliciesEqual', () => {
  test('identical policies are equal', () => {
    const p1: PermissionPolicy = {
      permissions: { Apps: ['read', 'create'] },
      app_permissions: { Secrets: ['read'] },
      global_access: true,
    }
    const p2: PermissionPolicy = {
      permissions: { Apps: ['read', 'create'] },
      app_permissions: { Secrets: ['read'] },
      global_access: true,
    }
    expect(arePoliciesEqual(p1, p2)).toBe(true)
  })

  test('different global_access are not equal', () => {
    const p1: PermissionPolicy = {
      permissions: {},
      app_permissions: {},
      global_access: true,
    }
    const p2: PermissionPolicy = {
      permissions: {},
      app_permissions: {},
      global_access: false,
    }
    expect(arePoliciesEqual(p1, p2)).toBe(false)
  })

  test('same actions in different order are equal', () => {
    const p1: PermissionPolicy = {
      permissions: { Apps: ['create', 'read'] },
      app_permissions: {},
      global_access: true,
    }
    const p2: PermissionPolicy = {
      permissions: { Apps: ['read', 'create'] },
      app_permissions: {},
      global_access: true,
    }
    expect(arePoliciesEqual(p1, p2)).toBe(true)
  })
})
