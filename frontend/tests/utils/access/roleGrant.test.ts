import {
  roleGrantViolations,
  userCanGrantPermission,
  userCanGrantRole,
  userCanGrantRoleFromAny,
  PermissionPolicy,
} from '@/utils/access/permissions'

const managerPolicy: PermissionPolicy = {
  permissions: {
    Organisation: ['read'],
    Members: ['create', 'read', 'update', 'delete'],
    ServiceAccounts: ['create', 'read', 'update', 'delete'],
    Roles: ['create', 'read', 'update', 'delete'],
    SSO: [],
  },
  app_permissions: {
    Environments: ['read', 'create', 'update', 'delete'],
    Secrets: ['create', 'read', 'update', 'delete'],
  },
  global_access: false,
}

const adminPolicy: PermissionPolicy = {
  permissions: {
    Organisation: ['read', 'update'],
    Members: ['create', 'read', 'update', 'delete'],
  },
  app_permissions: {
    Secrets: ['create', 'read', 'update', 'delete'],
  },
  global_access: true,
}

describe('roleGrantViolations', () => {
  test('returns empty array when the grant is within the actor policy', () => {
    const target: PermissionPolicy = {
      permissions: { Members: ['read', 'update'] },
      app_permissions: { Secrets: ['create', 'read'] },
      global_access: false,
    }
    expect(roleGrantViolations(managerPolicy, target)).toEqual([])
  })

  test('reports each permission exceeding the actor policy', () => {
    const target: PermissionPolicy = {
      permissions: { Organisation: ['read', 'delete'], SSO: ['create'] },
      app_permissions: {},
      global_access: false,
    }
    expect(roleGrantViolations(managerPolicy, target)).toEqual([
      'permissions:Organisation:delete',
      'permissions:SSO:create',
    ])
  })

  test('a missing resource key on the actor grants nothing', () => {
    const target: PermissionPolicy = {
      permissions: { MemberPersonalAccessTokens: ['read'] },
      app_permissions: {},
      global_access: false,
    }
    expect(roleGrantViolations(managerPolicy, target)).toEqual([
      'permissions:MemberPersonalAccessTokens:read',
    ])
  })

  test('org and app scopes are compared independently', () => {
    const actor: PermissionPolicy = {
      permissions: { ServiceAccounts: ['create', 'read'] },
      app_permissions: {},
      global_access: false,
    }
    const target: PermissionPolicy = {
      permissions: { ServiceAccounts: ['create'] },
      app_permissions: { ServiceAccounts: ['create'] },
      global_access: false,
    }
    expect(roleGrantViolations(actor, target)).toEqual(['app_permissions:ServiceAccounts:create'])
  })

  test('granting global_access requires a global-access actor', () => {
    const target: PermissionPolicy = {
      permissions: {},
      app_permissions: {},
      global_access: true,
    }
    expect(roleGrantViolations(managerPolicy, target)).toEqual(['global_access'])
  })

  test('global-access actors are exempt from the ceiling', () => {
    const target: PermissionPolicy = {
      permissions: { Organisation: ['delete'], SSO: ['create'] },
      app_permissions: { Environments: ['delete'] },
      global_access: true,
    }
    expect(roleGrantViolations(adminPolicy, target)).toEqual([])
  })

  test('null actor policy fails closed', () => {
    const target: PermissionPolicy = {
      permissions: { Members: ['read'] },
      app_permissions: {},
      global_access: false,
    }
    expect(roleGrantViolations(null, target)).toEqual(['permissions:Members:read'])
  })

  test('duplicate actions are reported once', () => {
    const target: PermissionPolicy = {
      permissions: { SSO: ['create', 'create'] },
      app_permissions: {},
      global_access: false,
    }
    expect(roleGrantViolations(managerPolicy, target)).toEqual(['permissions:SSO:create'])
  })

  test('malformed target scope is a violation, not a crash or a pass', () => {
    // Legacy pre-validation roles can store arbitrary JSON shapes
    const target = {
      permissions: ['read'],
      app_permissions: {},
      global_access: false,
    } as unknown as PermissionPolicy
    expect(roleGrantViolations(managerPolicy, target)).toEqual(['permissions:invalid'])
  })

  test('malformed target actions are a violation', () => {
    for (const actions of ['createreadupdatedelete', 5, true, [{ read: true }]]) {
      const target = {
        permissions: { Members: actions },
        app_permissions: {},
        global_access: false,
      } as unknown as PermissionPolicy
      expect(roleGrantViolations(managerPolicy, target)).toEqual(['permissions:Members:invalid'])
    }
  })

  test('malformed actor policy grants nothing', () => {
    const actor = {
      permissions: { Members: 'read' },
      app_permissions: 'junk',
      global_access: false,
    } as unknown as PermissionPolicy
    const target: PermissionPolicy = {
      permissions: { Members: ['read'] },
      app_permissions: {},
      global_access: false,
    }
    expect(roleGrantViolations(actor, target)).toEqual(['permissions:Members:read'])
  })
})

describe('userCanGrantPermission', () => {
  test('permits actions the actor holds', () => {
    expect(userCanGrantPermission(managerPolicy, 'Members', 'update')).toBe(true)
    expect(userCanGrantPermission(managerPolicy, 'Secrets', 'delete', true)).toBe(true)
  })

  test('denies actions the actor lacks', () => {
    expect(userCanGrantPermission(managerPolicy, 'Organisation', 'delete')).toBe(false)
    expect(userCanGrantPermission(managerPolicy, 'SSO', 'create')).toBe(false)
  })

  test('manager may grant every app Environments action', () => {
    // Manager holds app Environments delete so the default Service role fits under it
    for (const action of ['read', 'create', 'update', 'delete']) {
      expect(userCanGrantPermission(managerPolicy, 'Environments', action, true)).toBe(true)
    }
  })

  test('scope flag selects the correct permission map', () => {
    // Manager holds org ServiceAccounts CRUD but no app ServiceAccounts key
    expect(userCanGrantPermission(managerPolicy, 'ServiceAccounts', 'create')).toBe(true)
    expect(userCanGrantPermission(managerPolicy, 'ServiceAccounts', 'create', true)).toBe(false)
  })

  test('global-access actors may grant anything', () => {
    expect(userCanGrantPermission(adminPolicy, 'Organisation', 'delete')).toBe(true)
    expect(userCanGrantPermission(adminPolicy, 'Environments', 'delete', true)).toBe(true)
  })

  test('null actor policy fails closed', () => {
    expect(userCanGrantPermission(null, 'Members', 'read')).toBe(false)
  })

  test('malformed stored actions do not substring-match', () => {
    const actor = {
      permissions: { Members: 'readcreate' },
      app_permissions: {},
      global_access: false,
    } as unknown as PermissionPolicy
    expect(userCanGrantPermission(actor, 'Members', 'read')).toBe(false)
  })
})

describe('userCanGrantRole', () => {
  test('permits assigning a role within the actor ceiling', () => {
    const developerJson = JSON.stringify({
      permissions: { Members: ['read'], Roles: ['read'] },
      app_permissions: { Secrets: ['create', 'read', 'update', 'delete'] },
      global_access: false,
    })
    expect(userCanGrantRole(JSON.stringify(managerPolicy), developerJson)).toBe(true)
  })

  test('denies assigning a role exceeding the actor ceiling', () => {
    const strongRoleJson = JSON.stringify({
      permissions: { SSO: ['create', 'read', 'update', 'delete'] },
      app_permissions: {},
      global_access: false,
    })
    expect(userCanGrantRole(JSON.stringify(managerPolicy), strongRoleJson)).toBe(false)
  })

  test('global-access actor may assign any role', () => {
    expect(userCanGrantRole(JSON.stringify(adminPolicy), JSON.stringify(managerPolicy))).toBe(true)
  })

  test('fails closed on invalid target JSON', () => {
    expect(userCanGrantRole(JSON.stringify(adminPolicy), 'not-json')).toBe(false)
  })

  test('fails closed on invalid actor JSON with a non-empty target', () => {
    expect(userCanGrantRole('not-json', JSON.stringify(managerPolicy))).toBe(false)
  })
})

describe('userCanGrantRoleFromAny', () => {
  const orgRoleJson = JSON.stringify({
    permissions: { Members: ['read'] },
    app_permissions: {},
    global_access: false,
  })
  const overrideJson = JSON.stringify({
    permissions: { SSO: ['create'] },
    app_permissions: {},
    global_access: false,
  })

  test('union covers a target neither role covers alone', () => {
    const targetJson = JSON.stringify({
      permissions: { Members: ['read'], SSO: ['create'] },
      app_permissions: {},
      global_access: false,
    })
    expect(userCanGrantRole(orgRoleJson, targetJson)).toBe(false)
    expect(userCanGrantRole(overrideJson, targetJson)).toBe(false)
    expect(userCanGrantRoleFromAny([orgRoleJson, overrideJson], targetJson)).toBe(true)
  })

  test('denies when no role covers a permission', () => {
    const targetJson = JSON.stringify({
      permissions: { Members: ['read'], SCIM: ['read'] },
      app_permissions: {},
      global_access: false,
    })
    expect(userCanGrantRoleFromAny([orgRoleJson, overrideJson], targetJson)).toBe(false)
  })

  test('any global-access role exempts', () => {
    const targetJson = JSON.stringify({
      permissions: { Organisation: ['delete'] },
      app_permissions: {},
      global_access: false,
    })
    expect(userCanGrantRoleFromAny([orgRoleJson, JSON.stringify(adminPolicy)], targetJson)).toBe(
      true
    )
  })

  test('fails closed on empty actor list and invalid target JSON', () => {
    expect(userCanGrantRoleFromAny([], JSON.stringify(managerPolicy))).toBe(false)
    expect(userCanGrantRoleFromAny([orgRoleJson], 'not-json')).toBe(false)
  })
})
