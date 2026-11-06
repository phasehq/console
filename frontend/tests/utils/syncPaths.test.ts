import {
  buildSyncPathOptions,
  environmentPathHref,
  filterSyncPathOptions,
  normalizeSecretPath,
} from '@/utils/syncing/paths'

describe('normalizeSecretPath', () => {
  it.each([
    ['', '/'],
    ['/', '/'],
    ['workers', '/workers'],
    ['/workers/', '/workers'],
    ['//workers//cron/ ', '/workers/cron'],
  ])('normalises %p to %p', (input, expected) => {
    expect(normalizeSecretPath(input)).toBe(expected)
  })
})

describe('buildSyncPathOptions', () => {
  const folders = [
    { name: 'workers', path: '/', folderCount: 1, secretCount: 5 },
    { name: 'api', path: '/', folderCount: 0, secretCount: 1 },
    { name: 'cron', path: '/workers', folderCount: 0, secretCount: 2 },
  ]

  it('lists the root and every folder in tree order', () => {
    const options = buildSyncPathOptions(folders, [])
    expect(options.map((option) => option.path)).toEqual(['/', '/api', '/workers', '/workers/cron'])
    expect(options.map((option) => option.depth)).toEqual([0, 1, 1, 2])
    expect(options[0].folderCount).toBe(2)
  })

  it('counts only the static secrets stored at each exact path', () => {
    const options = buildSyncPathOptions(folders, ['/', '/', '/workers', '/workers/cron'])
    const counts = Object.fromEntries(options.map((option) => [option.path, option.secretCount]))
    expect(counts).toEqual({ '/': 2, '/api': 0, '/workers': 1, '/workers/cron': 1 })
  })

  it("falls back to each folder's own count when secrets can't be read", () => {
    const options = buildSyncPathOptions(folders, null)
    const counts = Object.fromEntries(options.map((option) => [option.path, option.secretCount]))
    expect(counts).toEqual({ '/': null, '/api': 1, '/workers': 5, '/workers/cron': 2 })
  })
})

describe('filterSyncPathOptions', () => {
  const options = buildSyncPathOptions(
    [
      { name: 'workers', path: '/' },
      { name: 'cron', path: '/workers' },
      { name: 'web', path: '/' },
      { name: 'network', path: '/web' },
    ],
    []
  )

  it('lists everything when there is no query', () => {
    expect(filterSyncPathOptions(options, ' ')).toEqual({
      options,
      customPath: null,
      hiddenCount: 0,
    })
  })

  it('ranks the exact path, then path prefixes, then name prefixes, then other matches', () => {
    const { options: matches, customPath } = filterSyncPathOptions(options, 'w')
    expect(matches.map((option) => option.path)).toEqual([
      '/web',
      '/web/network',
      '/workers',
      '/workers/cron',
    ])
    expect(customPath).toBe('/w')

    expect(filterSyncPathOptions(options, 'workers').options.map((option) => option.path)).toEqual([
      '/workers',
      '/workers/cron',
    ])
    expect(filterSyncPathOptions(options, 'workers/').customPath).toBeNull()
    expect(filterSyncPathOptions(options, 'net').options.map((option) => option.path)).toEqual([
      '/web/network',
    ])
  })

  it('caps the number of options listed', () => {
    const many = buildSyncPathOptions(
      Array.from({ length: 150 }, (_, i) => ({ name: `folder-${i}`, path: '/' })),
      []
    )
    const { options: listed, hiddenCount } = filterSyncPathOptions(many, '')
    expect(listed).toHaveLength(100)
    expect(hiddenCount).toBe(51)
  })
})

describe('environmentPathHref', () => {
  it('links to the environment root or the folder', () => {
    expect(environmentPathHref('acme', 'app-1', 'env-1', '/')).toBe(
      '/acme/apps/app-1/environments/env-1'
    )
    expect(environmentPathHref('acme', 'app-1', 'env-1', 'workers/cron/')).toBe(
      '/acme/apps/app-1/environments/env-1/workers/cron'
    )
  })
})
