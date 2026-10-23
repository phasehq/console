import { userCanCreateAgent, userHasOrganisationAgentPermission } from '@/utils/access/agents'

const permissions = (actions: string[]) =>
  JSON.stringify({
    permissions: { Agents: actions },
    app_permissions: {},
    global_access: false,
  })

describe('Agent permissions', () => {
  test('uses the organisation role for Agent actions', () => {
    const organisation = {
      memberId: 'member-1',
      role: { permissions: permissions(['read', 'create']) },
    }

    expect(userHasOrganisationAgentPermission(organisation, 'read')).toBe(true)
    expect(userHasOrganisationAgentPermission(organisation, 'create')).toBe(true)
    expect(userHasOrganisationAgentPermission(organisation, 'delete')).toBe(false)
  })

  test('allows creation only when the role grants create', () => {
    const creator = { role: { permissions: permissions(['create']) } }
    const reader = { role: { permissions: permissions(['read']) } }

    expect(userCanCreateAgent(creator)).toBe(true)
    expect(userCanCreateAgent(reader)).toBe(false)
    expect(userCanCreateAgent(null)).toBe(false)
  })
})
