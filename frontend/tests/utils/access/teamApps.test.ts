import { teamAppAccessChanges, TeamEnvScopes } from '@/utils/access/teamApps'

const scopes = (byApp: Record<string, string[]>): TeamEnvScopes =>
  Object.fromEntries(Object.entries(byApp).map(([appId, envIds]) => [appId, new Set(envIds)]))

describe('teamAppAccessChanges', () => {
  it('adds an app the team has no access to yet', () => {
    const changes = teamAppAccessChanges({}, scopes({ billing: ['dev', 'prod'] }), new Set())

    expect(changes).toEqual({
      toAdd: [{ appId: 'billing', envIds: ['dev', 'prod'] }],
      toUpdate: [],
      toRemove: [],
    })
  })

  it('replaces the scope of an app whose environments changed', () => {
    const changes = teamAppAccessChanges(
      scopes({ billing: ['dev'], payments: ['dev', 'prod'] }),
      scopes({ billing: ['prod'], payments: ['dev'] }),
      new Set(['billing', 'payments'])
    )

    expect(changes).toEqual({
      toAdd: [],
      toUpdate: [
        { appId: 'billing', envIds: ['prod'] },
        { appId: 'payments', envIds: ['dev'] },
      ],
      toRemove: [],
    })
  })

  it('changes nothing for an app whose environments are the same', () => {
    const changes = teamAppAccessChanges(
      scopes({ billing: ['dev', 'prod'] }),
      scopes({ billing: ['prod', 'dev'] }),
      new Set(['billing'])
    )

    expect(changes).toEqual({ toAdd: [], toUpdate: [], toRemove: [] })
  })

  it('removes an app with every environment deselected', () => {
    const changes = teamAppAccessChanges(scopes({ billing: ['dev'] }), {}, new Set(['billing']))

    expect(changes).toEqual({ toAdd: [], toUpdate: [], toRemove: ['billing'] })
  })

  it('replaces the scope of an app the team reaches only through a hidden environment', () => {
    // Its only environment for the team is scheduled for deletion, so the app
    // has nothing in the initial state. Adding would keep that environment,
    // and restoring it would give the team both.
    const changes = teamAppAccessChanges({}, scopes({ billing: ['prod'] }), new Set(['billing']))

    expect(changes).toEqual({
      toAdd: [],
      toUpdate: [{ appId: 'billing', envIds: ['prod'] }],
      toRemove: [],
    })
  })

  it('leaves such an app alone when nothing is selected for it', () => {
    const changes = teamAppAccessChanges({}, {}, new Set(['billing']))

    expect(changes).toEqual({ toAdd: [], toUpdate: [], toRemove: [] })
  })
})
