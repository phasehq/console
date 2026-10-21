import { AppType, EnvironmentType, RoleType, TeamType } from '@/apollo/graphql'
import {
  asPredicate,
  buildAccessIndex,
  descriptionPreview,
  envColumnLayout,
  envColumns,
  filterApps,
  fitSharedColumns,
  groupEnvironments,
  isGlobalAccessRole,
  rankByQuery,
  roleBreakdown,
  sortApps,
  standardColumnKey,
  splitQuoted,
  summariseApps,
  syncHealth,
  syncServices,
} from '@/utils/dashboard'

const sync = (id: string, service: string, provider: string, status: string) => ({
  id,
  status,
  serviceInfo: {
    id: service,
    name: service.toUpperCase(),
    provider: { id: provider, name: provider },
  },
})

const app = (id: string, overrides: Partial<Record<string, any>> = {}) =>
  ({
    id,
    name: id,
    description: null,
    updatedAt: '2026-01-01T00:00:00Z',
    members: [],
    serviceAccounts: [],
    environments: [],
    ...overrides,
  }) as unknown as AppType

const role = (id: string, name: string, isDefault = true) => ({ id, name, isDefault }) as RoleType

const env = (id: string, name: string, envType = 'CUSTOM') =>
  ({ id, name, envType }) as unknown as EnvironmentType

describe('env columns', () => {
  it('places standard env types in their column, whatever they are named', () => {
    expect(standardColumnKey(env('d', 'Local', 'DEV'))).toBe('DEV')
    expect(standardColumnKey(env('s', 'Staging', 'staging'))).toBe('STAGING')
    expect(standardColumnKey(env('p', 'Live', 'PROD'))).toBe('PROD')
  })

  it('places custom envs named like a standard env in its column, ignoring case and spaces', () => {
    expect(standardColumnKey(env('a', 'development'))).toBe('DEV')
    expect(standardColumnKey(env('b', ' STAGING '))).toBe('STAGING')
    expect(standardColumnKey(env('c', 'Production'))).toBe('PROD')
    expect(standardColumnKey(env('d', 'dev'))).toBeUndefined()
  })

  const withEnvs = (id: string, ...names: string[]) =>
    app(id, { environments: names.map((name, i) => env(`${id}-${i}`, name)) })

  it('gives custom names shared by enough apps a column, most shared first', () => {
    const apps = [
      withEnvs('a', 'CI', 'preview', 'sandbox'),
      withEnvs('b', 'ci', 'Preview'),
      withEnvs('c', 'ci', 'preview', 'qa-eu'),
      withEnvs('d', 'testing', 'Testing'),
      withEnvs('e', 'testing', 'production'),
    ]
    const layout = envColumnLayout(apps)
    expect(layout.shared).toEqual([
      { key: 'name:ci', label: 'ci' },
      { key: 'name:preview', label: 'preview' },
      { key: 'name:testing', label: 'testing' },
    ])
    // 'sandbox' and 'qa-eu' are in one app each, so Other always stays
    expect(layout.otherUnless).toBe(Infinity)
  })

  it('counts each app once, and never gives a custom env named Other its own column', () => {
    expect(envColumnLayout([withEnvs('a', 'qa', 'QA'), withEnvs('b')]).shared).toEqual([])
    const layout = envColumnLayout([withEnvs('a', 'Other'), withEnvs('b', 'other')])
    expect(layout.shared).toEqual([])
    expect(envColumns(layout, 0).map((c) => c.key)).toContain('OTHER')
  })

  it('needs a name in at least 10% of apps', () => {
    const apps = [
      withEnvs('a', 'preview'),
      withEnvs('b', 'preview'),
      ...Array.from({ length: 28 }, (_, i) => withEnvs(`x${i}`)),
    ]
    expect(envColumnLayout(apps).shared).toEqual([])
    expect(envColumnLayout(apps.slice(0, 20)).shared.map((c) => c.key)).toEqual(['name:preview'])
  })

  it('drops Other once every custom env has a column', () => {
    const layout = envColumnLayout([withEnvs('a', 'ci', 'preview'), withEnvs('b', 'CI', 'Preview')])
    expect(layout.otherUnless).toBe(2)
    expect(envColumns(layout, 2).map((c) => c.key)).toEqual([
      'DEV',
      'STAGING',
      'PROD',
      'name:ci',
      'name:preview',
    ])
    expect(envColumns(layout, 1).map((c) => c.key)).toEqual([
      'DEV',
      'STAGING',
      'PROD',
      'name:ci',
      'OTHER',
    ])
    expect(envColumns(envColumnLayout([app('a')]), 0).map((c) => c.key)).toEqual([
      'DEV',
      'STAGING',
      'PROD',
    ])
  })

  it('fits as many shared columns as the width allows', () => {
    const sizes = { app: 160, env: 80, other: 120, access: 96, maxShared: 3 }
    // Both names shared: two columns and no Other (656px) beat one column plus Other (696px)
    const both = envColumnLayout([withEnvs('a', 'ci', 'preview'), withEnvs('b', 'ci', 'preview')])
    expect(fitSharedColumns(both, 655, sizes)).toBe(0)
    expect(fitSharedColumns(both, 656, sizes)).toBe(2)
    expect(fitSharedColumns(both, 5000, { ...sizes, maxShared: 1 })).toBe(1)
    // An unshared name keeps Other, so each shared column needs room next to it
    const withOther = envColumnLayout([withEnvs('a', 'ci', 'qa'), withEnvs('b', 'ci')])
    expect(fitSharedColumns(withOther, 695, sizes)).toBe(0)
    expect(fitSharedColumns(withOther, 696, sizes)).toBe(1)
  })

  it('groups environments by column, keeping order and folding the rest into Other', () => {
    const layout = envColumnLayout([withEnvs('a', 'ci'), withEnvs('b', 'CI')])
    const columns = envColumns(layout, 1)
    const groups = groupEnvironments(
      [
        env('d', 'Development', 'DEV'),
        env('c', 'Ci'),
        env('q', 'qa'),
        env('p', 'production'),
        env('r', 'review'),
      ] as any,
      [...columns, { key: 'OTHER', label: 'Other' }]
    )
    expect(groups.DEV.map((e) => e.id)).toEqual(['d'])
    expect(groups.STAGING).toEqual([])
    expect(groups.PROD.map((e) => e.id)).toEqual(['p'])
    expect(groups['name:ci'].map((e) => e.id)).toEqual(['c'])
    expect(groups.OTHER.map((e) => e.id)).toEqual(['q', 'r'])
  })
})

describe('syncHealth', () => {
  it('classifies statuses', () => {
    expect(syncHealth('COMPLETED')).toBe('ok')
    expect(syncHealth('FAILED')).toBe('failing')
    expect(syncHealth('TIMED_OUT')).toBe('failing')
    expect(syncHealth('QUEUED')).toBe('pending')
    expect(syncHealth('IN_PROGRESS')).toBe('pending')
    expect(syncHealth('CANCELLED')).toBe('skipped')
  })
})

describe('summariseApps', () => {
  const apps = [
    app('web', {
      environments: [
        { id: 'w1', envType: 'PROD', syncs: [sync('s1', 'vercel', 'vercel', 'COMPLETED')] },
        {
          id: 'w2',
          envType: 'STAGING',
          syncs: [
            sync('s2', 'vercel', 'vercel', 'FAILED'),
            sync('s3', 'github_actions', 'github', 'COMPLETED'),
          ],
        },
      ],
    }),
    app('api', {
      environments: [
        { id: 'a1', envType: 'PROD', syncs: [sync('s4', 'vercel', 'vercel', 'QUEUED')] },
        { id: 'a2', envType: 'DEV', syncs: [] },
      ],
    }),
    app('docs', { environments: [{ id: 'd1', envType: 'DEV', syncs: [] }] }),
  ]

  it('counts apps, environments and syncs by health', () => {
    const summary = summariseApps(apps)
    expect(summary.apps).toBe(3)
    expect(summary.environments).toBe(5)
    expect(summary.appsWithSyncs).toBe(2)
    expect(summary.syncs).toEqual({ total: 4, ok: 2, failing: 1, pending: 1, skipped: 0 })
  })
})

describe('syncServices', () => {
  const apps = [
    app('api', {
      environments: [
        {
          id: 'a-prod',
          envType: 'PROD',
          syncs: [
            sync('s1', 'vercel', 'vercel', 'COMPLETED'),
            sync('s2', 'github_actions', 'github', 'COMPLETED'),
          ],
        },
      ],
    }),
    app('web', {
      environments: [
        { id: 'w-dev', envType: 'DEV', syncs: [sync('s3', 'github_actions', 'github', 'FAILED')] },
        {
          id: 'w-prod',
          envType: 'PROD',
          syncs: [sync('s4', 'github_actions', 'github', 'COMPLETED')],
        },
      ],
    }),
  ]

  it('lists each integration with its apps and syncs, most apps first', () => {
    expect(syncServices(apps)).toEqual([
      { id: 'github_actions', name: 'GITHUB_ACTIONS', apps: 2, syncs: 3 },
      { id: 'vercel', name: 'VERCEL', apps: 1, syncs: 1 },
    ])
  })
})

describe('sortApps / filterApps', () => {
  const apps = [
    app('b', { updatedAt: '2026-01-03T00:00:00Z', description: 'Billing' }),
    app('a', {
      updatedAt: '2026-01-01T00:00:00Z',
      environments: [
        { id: 'e', envType: 'PROD', syncs: [sync('s', 'vercel', 'vercel', 'FAILED')] },
      ],
    }),
    app('c', { updatedAt: '2026-01-02T00:00:00Z' }),
  ]

  it('sorts by name, recency and sync count', () => {
    expect(sortApps(apps, 'name').map((a) => a.id)).toEqual(['a', 'b', 'c'])
    expect(sortApps(apps, 'updated').map((a) => a.id)).toEqual(['b', 'c', 'a'])
    expect(sortApps(apps, 'syncs')[0].id).toBe('a')
  })

  it('does not mutate the input', () => {
    sortApps(apps, 'name')
    expect(apps.map((a) => a.id)).toEqual(['b', 'a', 'c'])
  })

  it('filters by name or description, and by failing syncs', () => {
    expect(filterApps(apps, 'bill').map((a) => a.id)).toEqual(['b'])
    expect(filterApps(apps, '', true).map((a) => a.id)).toEqual(['a'])
    expect(filterApps(apps, '  ').length).toBe(3)
  })

  it('filters by the integration an app syncs to', () => {
    expect(filterApps(apps, '', false, 'vercel').map((a) => a.id)).toEqual(['a'])
    expect(filterApps(apps, '', false, 'github_actions')).toEqual([])
    expect(filterApps(apps, 'bill', false, 'vercel')).toEqual([])
  })

  it('ranks name matches first and keeps the sort order within a rank', () => {
    const matches = [
      app('api-zeta'),
      app('billing', { description: 'Calls the API' }),
      app('public-api'),
      app('api-alpha'),
      app('api'),
      app('audit', { description: 'api logs' }),
    ]
    expect(rankByQuery(matches, ' API ').map((a) => a.id)).toEqual([
      'api',
      'api-zeta',
      'api-alpha',
      'public-api',
      'billing',
      'audit',
    ])
    expect(rankByQuery(matches, ' ')).toBe(matches)
  })
})

describe('buildAccessIndex', () => {
  const apps = [
    app('web', { members: [{ id: 'm1' }], serviceAccounts: [{ id: 'sa1' }] }),
    app('api', { members: [{ id: 'm1' }, { id: 'm2' }] }),
  ]
  const teams = [
    {
      id: 't1',
      apps: [{ id: 'web' }, { id: 'hidden' }],
      members: [{ orgMember: { id: 'm2' } }, { serviceAccount: { id: 'sa2' } }],
    },
  ] as unknown as TeamType[]

  it('combines direct and team grants', () => {
    const index = buildAccessIndex(apps, teams)
    expect(Array.from(index.members.get('m1')!).sort()).toEqual(['api', 'web'])
    expect(Array.from(index.members.get('m2')!).sort()).toEqual(['api', 'web'])
    expect(Array.from(index.serviceAccounts.get('sa2')!)).toEqual(['web'])
  })

  it('ignores team apps the viewer cannot see', () => {
    const index = buildAccessIndex(apps, teams)
    expect(index.appMembers.has('hidden')).toBe(false)
  })

  it('keeps per-app counts without double counting', () => {
    const index = buildAccessIndex(apps, teams)
    expect(index.appMembers.get('web')!.size).toBe(2)
    expect(index.appServiceAccounts.get('web')!.size).toBe(2)
    expect(index.appMembers.get('api')!.size).toBe(2)
  })
})

describe('roles', () => {
  it('orders managed roles by rank, then custom roles by size', () => {
    const owner = role('o', 'Owner')
    const dev = role('d', 'Developer')
    const contractor = role('c', 'Contractor', false)
    const release = role('r', 'Release Manager', false)
    const counts = roleBreakdown([
      { role: dev },
      { role: release },
      { role: contractor },
      { role: contractor },
      { role: owner },
      { role: null },
    ])
    expect(counts.map((c) => [c.role.name, c.count])).toEqual([
      ['Owner', 1],
      ['Developer', 1],
      ['Contractor', 2],
      ['Release Manager', 1],
    ])
  })

  it('treats only the managed Owner and Admin roles as global', () => {
    expect(isGlobalAccessRole(role('o', 'Owner'))).toBe(true)
    expect(isGlobalAccessRole(role('a', 'Admin'))).toBe(true)
    expect(isGlobalAccessRole(role('x', 'Admin', false))).toBe(false)
    expect(isGlobalAccessRole(role('m', 'Manager'))).toBe(false)
    expect(isGlobalAccessRole(null)).toBe(false)
  })
})

describe('text helpers', () => {
  it('splits quoted names out of audit descriptions', () => {
    expect(splitQuoted("Created app 'web' in 'acme'")).toEqual([
      { text: 'Created app ', quoted: false },
      { text: 'web', quoted: true },
      { text: ' in ', quoted: false },
      { text: 'acme', quoted: true },
    ])
    expect(splitQuoted('No quotes')).toEqual([{ text: 'No quotes', quoted: false }])
  })

  it('turns a description into a predicate for an actor name', () => {
    expect(asPredicate("Created app 'web'")).toBe("created app 'web'")
    expect(asPredicate('SCIM provisioned a member')).toBe('SCIM provisioned a member')
    expect(asPredicate('')).toBe('')
  })

  it('previews markdown descriptions as plain text', () => {
    expect(descriptionPreview('## Example App\n\nThis is an **example** app.')).toBe(
      'This is an example app.'
    )
    expect(descriptionPreview('- See [the docs](https://docs.phase.dev)')).toBe('See the docs')
    expect(descriptionPreview('# Only a heading')).toBe('Only a heading')
    expect(descriptionPreview(null)).toBe('')
  })
})
