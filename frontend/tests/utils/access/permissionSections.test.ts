import {
  AGENT_PERMISSION_ACTIONS,
  ORGANISATION_PERMISSION_ACTIONS,
} from '@/utils/access/permissionSections'

describe('role permission sections', () => {
  test('keeps Agent permissions in the standard CRUD model', () => {
    expect(AGENT_PERMISSION_ACTIONS).toEqual(['read', 'create', 'update', 'delete'])
    expect(AGENT_PERMISSION_ACTIONS).toEqual(ORGANISATION_PERMISSION_ACTIONS)
  })
})
