import {
  buildSyncPathOptions,
  countSecretsByPath,
  environmentPathHref,
  filterSyncPathOptions,
  normalizeSecretPath,
} from '@/utils/syncing/paths'

describe('normalizeSecretPath', () => {
  // Expected values are the output of the backend's normalize_path_string, which sync
  // mutations apply to the path before saving it
  it.each([
    ['', '/'],
    ['/', '/'],
    ['workers', '/workers'],
    ['/workers/', '/workers'],
    ['//workers//cron/', '/workers/cron'],
    ['///', '/'],
    ['a//', '/a'],
    ['/svc ', '/svc '],
    [' svc', '/ svc'],
    ['svc /', '/svc '],
    ['a b//c', '/a b/c'],
  ])('normalises %p to %p, like the backend', (input, expected) => {
    expect(normalizeSecretPath(input)).toBe(expected)
  })
})

describe('buildSyncPathOptions', () => {
  const folders = [
    { name: 'workers', path: '/' },
    { name: 'api', path: '/' },
    { name: 'cron', path: '/workers' },
  ]

  it('lists the root and every folder in tree order', () => {
    const options = buildSyncPathOptions(folders, new Map())
    expect(options.map((option) => option.path)).toEqual(['/', '/api', '/workers', '/workers/cron'])
    expect(options.map((option) => option.depth)).toEqual([0, 1, 1, 2])
  })

  it('counts the subfolders directly inside each path', () => {
    const options = buildSyncPathOptions(folders, new Map())
    const counts = Object.fromEntries(options.map((option) => [option.path, option.folderCount]))
    expect(counts).toEqual({ '/': 2, '/api': 0, '/workers': 1, '/workers/cron': 0 })
  })

  it('takes each path’s secret count from the counts for that exact path', () => {
    const secretCounts = countSecretsByPath([
      { path: '/', secretCount: 2 },
      { path: '/workers', secretCount: 1 },
      { path: '/workers/cron', secretCount: 1 },
    ])
    const options = buildSyncPathOptions(folders, secretCounts)
    const counts = Object.fromEntries(options.map((option) => [option.path, option.secretCount]))
    expect(counts).toEqual({ '/': 2, '/api': 0, '/workers': 1, '/workers/cron': 1 })
  })

  it('keeps folder names exactly as stored, like the backend', () => {
    const options = buildSyncPathOptions(
      [{ name: 'svc ', path: '/' }],
      countSecretsByPath([{ path: '/svc ', secretCount: 3 }])
    )
    expect(options.map((option) => [option.path, option.secretCount])).toEqual([
      ['/', 0],
      ['/svc ', 3],
    ])
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
    new Map()
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
    expect(filterSyncPathOptions(options, 'net').options.map((option) => option.path)).toEqual([
      '/web/network',
    ])
  })

  it('offers the typed path unless it already exists, when it is the first match', () => {
    expect(filterSyncPathOptions(options, 'work').customPath).toBe('/work')

    const exact = filterSyncPathOptions(options, 'workers/')
    expect(exact.customPath).toBeNull()
    expect(exact.options[0].path).toBe('/workers')
  })

  it('trims the typed path at the ends only', () => {
    expect(filterSyncPathOptions(options, ' new folder ').customPath).toBe('/new folder')
  })

  it('caps the number of options listed', () => {
    const many = buildSyncPathOptions(
      Array.from({ length: 150 }, (_, i) => ({ name: `folder-${i}`, path: '/' })),
      new Map()
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
