import { AppType, RoleType, TeamType } from '@/apollo/graphql'
import {
  asPredicate,
  buildAccessIndex,
  descriptionPreview,
  envColumn,
  filterApps,
  groupEnvironments,
  isGlobalAccessRole,
  roleBreakdown,
  sortApps,
  splitQuoted,
  summariseApps,
  syncHealth,
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

describe('envColumn', () => {
  it('maps standard env types and folds the rest into OTHER', () => {
    expect(envColumn({ envType: 'DEV' } as any)).toBe('DEV')
    expect(envColumn({ envType: 'STAGING' } as any)).toBe('STAGING')
    expect(envColumn({ envType: 'PROD' } as any)).toBe('PROD')
    expect(envColumn({ envType: 'CUSTOM' } as any)).toBe('OTHER')
  })

  it('accepts lowercase types written by the REST API', () => {
    expect(envColumn({ envType: 'prod' } as any)).toBe('PROD')
  })

  it('groups environments by column, keeping order', () => {
    const envs = [
      { id: 'd', envType: 'DEV' },
      { id: 'q', envType: 'CUSTOM' },
      { id: 'p', envType: 'PROD' },
      { id: 'r', envType: 'CUSTOM' },
    ] as any
    const groups = groupEnvironments(envs)
    expect(groups.DEV.map((e) => e.id)).toEqual(['d'])
    expect(groups.STAGING).toEqual([])
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

  it('groups syncs by service, busiest first, with distinct apps', () => {
    const [vercel, github] = summariseApps(apps).services
    expect(vercel.id).toBe('vercel')
    expect(vercel.syncs.total).toBe(3)
    expect(vercel.syncs.failing).toBe(1)
    expect(vercel.appIds.sort()).toEqual(['api', 'web'])
    expect(github.providerId).toBe('github')
    expect(github.appIds).toEqual(['web'])
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
