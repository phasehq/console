import { ApiSecretTypeChoices, EnvironmentType, SecretType } from '@/apollo/graphql'
import { AppSecret } from '@/app/[team]/apps/[app]/types'
import {
  alignServerRows,
  appSecretRowIsEdited,
  buildAppSecretRows,
  carryRowKeys,
  dirtyEnvIds,
  duplicateKeyRowIds,
  envSecretsEqual,
  flattenAppSecrets,
  groupRotatingRows,
  mergeAppSecretsUpdate,
  restoreAppSecretEntries,
  revertAppSecretEntries,
  snapshotHasDeploy,
  staleAppSecretEntries,
} from '@/utils/appSecrets'

const dev = { id: 'dev', name: 'Development' } as EnvironmentType
const staging = { id: 'staging', name: 'Staging' } as EnvironmentType
const prod = { id: 'prod', name: 'Production' } as EnvironmentType
const envs = [dev, staging, prod]

const secret = (id: string, key: string, value: string, extra: Partial<SecretType> = {}) =>
  ({
    id,
    key,
    value,
    comment: '',
    tags: [],
    path: '/',
    type: ApiSecretTypeChoices.Secret,
    ...extra,
  }) as SecretType

const row = (key: string, values: Record<string, SecretType | null>): AppSecret => ({
  id: `app-${key}`,
  key,
  envs: envs.map((env) => ({ env, secret: values[env.id] ?? null })),
})

describe('envSecretsEqual', () => {
  it('treats two missing values as equal', () => {
    expect(envSecretsEqual(null, undefined)).toBe(true)
  })

  it('detects value, key, type, comment, tag and delete-flag changes', () => {
    const base = secret('1', 'A', 'x')
    expect(envSecretsEqual(base, { ...base })).toBe(true)
    expect(envSecretsEqual(base, { ...base, value: 'y' })).toBe(false)
    expect(envSecretsEqual(base, { ...base, key: 'B' })).toBe(false)
    expect(envSecretsEqual(base, { ...base, type: ApiSecretTypeChoices.Config })).toBe(false)
    expect(envSecretsEqual(base, { ...base, comment: 'note' })).toBe(false)
    expect(
      envSecretsEqual(base, { ...base, tags: [{ id: 't', name: 't', color: '#fff' }] } as SecretType)
    ).toBe(false)
    expect(envSecretsEqual(base, { ...base, stagedForDelete: true } as SecretType)).toBe(false)
  })
})

describe('buildAppSecretRows', () => {
  it('combines one row per key across envs, with null where a key is missing', () => {
    const rows = buildAppSecretRows('app', [
      { env: dev, secrets: [secret('d1', 'A', '1'), secret('d2', 'B', '2')] },
      { env: staging, secrets: [secret('s1', 'A', '3')] },
      { env: prod, secrets: [] },
    ])

    expect(rows.map((r) => r.id)).toEqual(['app:/:A', 'app:/:B'])
    expect(rows[0].path).toBe('/')
    expect(rows[0].envs.map((e) => e.secret?.id ?? null)).toEqual(['d1', 's1', null])
    expect(rows[1].envs.map((e) => e.secret?.id ?? null)).toEqual(['d2', null, null])
  })

  it('keeps duplicate keys within an env as separate rows', () => {
    const rows = buildAppSecretRows('app', [
      { env: dev, secrets: [secret('d1', 'A', '1'), secret('d2', 'A', '2')] },
      { env: staging, secrets: [secret('s1', 'A', '3')] },
    ])

    expect(rows.map((r) => r.id)).toEqual(['app:/:A', 'app:/:A#2'])
    expect(rows[0].envs.map((e) => e.secret?.id ?? null)).toEqual(['d1', 's1'])
    expect(rows[1].envs.map((e) => e.secret?.id ?? null)).toEqual(['d2', null])
  })
})

describe('buildAppSecretRows with folders', () => {
  it('keeps the same key in different folders as separate rows', () => {
    const rows = buildAppSecretRows('app', [
      {
        env: dev,
        secrets: [secret('d1', 'A', '1'), secret('d2', 'A', '2', { path: '/backend' })],
      },
      { env: staging, secrets: [secret('s1', 'A', '3', { path: '/backend' })] },
    ])

    expect(rows.map((r) => [r.id, r.path])).toEqual([
      ['app:/:A', '/'],
      ['app:/backend:A', '/backend'],
    ])
    expect(rows[1].envs.map((e) => e.secret?.id ?? null)).toEqual(['d2', 's1'])
  })
})

describe('dirtyEnvIds', () => {
  it('reports only the envs whose entries changed', () => {
    const server = [row('A', { dev: secret('d1', 'A', '1'), prod: secret('p1', 'A', '9') })]
    const client = [
      row('A', { dev: secret('d1', 'A', 'changed'), prod: secret('p1', 'A', '9') }),
    ]
    expect([...dirtyEnvIds(server, client)]).toEqual(['dev'])
  })

  it('counts new rows and staged deletions against their envs', () => {
    const server = [row('A', { prod: secret('p1', 'A', '9') })]
    const client = [
      row('A', { prod: { ...secret('p1', 'A', '9'), stagedForDelete: true } as SecretType }),
      { ...row('NEW', { staging: secret('new-1', 'NEW', '') }), id: 'client-row' },
    ]
    expect([...dirtyEnvIds(server, client)].sort()).toEqual(['prod', 'staging'])
  })

  it('is empty when nothing changed', () => {
    const server = [row('A', { dev: secret('d1', 'A', '1') })]
    expect(dirtyEnvIds(server, server).size).toBe(0)
  })
})

describe('appSecretRowIsEdited', () => {
  it('flags new rows and renames', () => {
    const server = row('A', { dev: secret('d1', 'A', '1') })
    expect(appSecretRowIsEdited(undefined, server)).toBe(true)
    expect(appSecretRowIsEdited(server, { ...server, key: 'B' })).toBe(true)
    expect(appSecretRowIsEdited(server, server)).toBe(false)
  })
})

describe('mergeAppSecretsUpdate', () => {
  it('keeps edited entries and takes the new server copy everywhere else', () => {
    const prevServer = [row('A', { dev: secret('d1', 'A', '1'), staging: secret('s1', 'A', '2') })]
    const prevClient = [
      row('A', { dev: secret('d1', 'A', 'edited'), staging: secret('s1', 'A', '2') }),
    ]
    // The background decrypt of production lands while dev has an unsaved edit
    const nextServer = [
      row('A', {
        dev: secret('d1', 'A', '1'),
        staging: secret('s1', 'A', '2'),
        prod: secret('p1', 'A', '3'),
      }),
      row('PROD_ONLY', { prod: secret('p2', 'PROD_ONLY', '4') }),
    ]

    const merged = mergeAppSecretsUpdate(prevServer, prevClient, nextServer, envs)

    expect(merged.map((r) => r.id)).toEqual(['app-A', 'app-PROD_ONLY'])
    expect(merged[0].envs.map((e) => e.secret?.value ?? null)).toEqual(['edited', '2', '3'])
    expect(merged[1]).toBe(nextServer[1])
  })

  it('reuses the server row when nothing in it was edited', () => {
    const prevServer = [row('A', { dev: secret('d1', 'A', '1') })]
    const nextServer = [row('A', { dev: secret('d1', 'A', '1'), prod: secret('p1', 'A', '2') })]
    const merged = mergeAppSecretsUpdate(prevServer, prevServer, nextServer, envs)
    expect(merged[0]).toBe(nextServer[0])
  })

  it('keeps client-only rows and a renamed key', () => {
    const prevServer = [row('A', { dev: secret('d1', 'A', '1') })]
    const renamed = { ...row('A', { dev: secret('d1', 'B', '1') }), key: 'B' }
    const created = { ...row('NEW', { dev: secret('new-1', 'NEW', 'v') }), id: 'client-row' }
    const nextServer = [row('A', { dev: secret('d1', 'A', '1'), prod: secret('p1', 'A', '2') })]

    const merged = mergeAppSecretsUpdate(prevServer, [renamed, created], nextServer, envs)

    expect(merged.map((r) => [r.id, r.key])).toEqual([
      ['app-A', 'B'],
      ['client-row', 'NEW'],
    ])
    // Production was hidden during the rename, so it keeps its own key
    expect(merged[0].envs.map((e) => e.secret?.key ?? null)).toEqual(['B', null, 'A'])
  })

  it('drops untouched rows that were deleted upstream', () => {
    const prevServer = [row('A', { dev: secret('d1', 'A', '1') })]
    expect(mergeAppSecretsUpdate(prevServer, prevServer, [], envs)).toEqual([])
  })
})

describe('revertAppSecretEntries', () => {
  const server = [
    row('A', { dev: secret('d1', 'A', '1'), staging: secret('s1', 'A', '2'), prod: secret('p1', 'A', '3') }),
  ]
  const renamed = {
    ...row('A', { dev: secret('d1', 'B', '1'), staging: secret('s1', 'B', '2'), prod: secret('p1', 'B', '3') }),
    key: 'B',
  }
  type Entry = AppSecret['envs'][number]
  const bySecret = (id: string) => (entry: Entry) => entry.secret?.id === id
  const byEnv = (envId: string) => (entry: Entry) => entry.env.id === envId
  const everything = (entry: Entry) => Boolean(entry.secret)
  const rowIds = () => {
    let n = 0
    return () => `split-${++n}`
  }
  const shape = (rows: AppSecret[]) =>
    Object.fromEntries(rows.map((r) => [r.id, [r.key, ...r.envs.map((e) => e.secret?.key ?? null)]]))

  it('puts one value back and keeps the edits in other envs', () => {
    const client = [row('A', { dev: secret('d1', 'A', 'x'), staging: secret('s1', 'A', 'y'), prod: secret('p1', 'A', '3') })]
    const [reverted] = revertAppSecretEntries(client, server, bySecret('d1'))
    expect(reverted.envs.map((e) => e.secret?.value ?? null)).toEqual(['1', 'y', '3'])
  })

  it('hands back the server row, key included, once nothing is left to deploy', () => {
    expect(revertAppSecretEntries([renamed], server, everything)[0]).toBe(server[0])
  })

  it('splits a key whose rename is put back in one env: the old key there, the new one in the rest', () => {
    const split = revertAppSecretEntries([renamed], server, byEnv('dev'), rowIds())
    expect(shape(split)).toEqual({ 'app-A': ['B', null, 'B', 'B'], 'split-1': ['A', 'A', null, null] })

    // Each row compares with the server copies of the values it holds
    const aligned = alignServerRows(server, split)
    expect(shape(aligned)).toEqual({ 'app-A': ['A', null, 'A', 'A'], 'split-1': ['A', 'A', null, null] })
    expect([...dirtyEnvIds(aligned, split)].sort()).toEqual(['prod', 'staging'])
    expect(appSecretRowIsEdited(aligned.find((r) => r.id === 'split-1'), split[1])).toBe(false)
  })

  it('gathers values put back later under the old key, down to the server row', () => {
    const newRowId = rowIds()
    const once = revertAppSecretEntries([renamed], server, byEnv('dev'), newRowId)
    const twice = revertAppSecretEntries(once, server, bySecret('s1'), newRowId)
    expect(shape(twice)).toEqual({ 'app-A': ['B', null, null, 'B'], 'split-1': ['A', 'A', 'A', null] })
    const thrice = revertAppSecretEntries(twice, server, byEnv('prod'), newRowId)
    expect(thrice).toHaveLength(1)
    expect(thrice[0]).toBe(server[0])
  })

  it('takes a value a hidden env kept under the old key along', () => {
    // Production was hidden during the rename
    const mixed = { ...renamed, envs: renamed.envs.map((e) => (e.env.id === 'prod' ? server[0].envs[2] : e)) }
    const split = revertAppSecretEntries([mixed], server, byEnv('dev'), rowIds())
    expect(shape(split)).toEqual({ 'app-A': ['B', null, 'B', null], 'split-1': ['A', 'A', null, 'A'] })
  })

  it('unstages a delete, drops a new value, and drops a new row left empty', () => {
    const client = [
      row('A', {
        dev: { ...secret('d1', 'A', '1'), stagedForDelete: true } as SecretType,
        staging: secret('s1', 'A', '2'),
        prod: secret('p1', 'A', '3'),
      }),
      { ...row('NEW', { dev: secret('new-d', 'NEW', 'v'), staging: secret('new-s', 'NEW', 'w') }), id: 'client-row' },
    ]
    const reverted = revertAppSecretEntries(client, server, byEnv('dev'))
    expect(reverted[0]).toBe(server[0])
    expect(shape(reverted)['client-row']).toEqual(['NEW', null, 'NEW', null])
    expect(revertAppSecretEntries(reverted, server, bySecret('new-s'))).toEqual([server[0]])
  })

  it('leaves rows without a matching edit untouched', () => {
    const client = [row('A', { dev: secret('d1', 'A', 'x'), staging: secret('s1', 'A', '2'), prod: secret('p1', 'A', '3') })]
    expect(revertAppSecretEntries(client, server, byEnv('staging'))[0]).toBe(client[0])
    expect(alignServerRows(server, client)).toBe(server)
  })

  it('keeps a split key apart when a fresh snapshot is rebased onto', () => {
    const split = revertAppSecretEntries([renamed], server, byEnv('dev'), rowIds())
    const next = [
      row('A', { dev: secret('d1', 'A', 'upstream'), staging: secret('s1', 'A', '2'), prod: secret('p1', 'A', '3') }),
    ]
    const merged = mergeAppSecretsUpdate(
      alignServerRows(server, split),
      split,
      alignServerRows(next, split),
      envs
    )
    expect(shape(merged)).toEqual({ 'app-A': ['B', null, 'B', 'B'], 'split-1': ['A', 'A', null, null] })
    // The untouched value follows the server
    expect(merged.find((r) => r.id === 'split-1')!.envs[0].secret!.value).toBe('upstream')
    expect([...dirtyEnvIds(alignServerRows(next, merged), merged)].sort()).toEqual(['prod', 'staging'])
  })

  describe('undone', () => {
    it('joins a split key back into its row', () => {
      const discarded = staleAppSecretEntries([renamed], server, byEnv('dev'))
      const split = revertAppSecretEntries([renamed], server, byEnv('dev'), rowIds())
      expect(restoreAppSecretEntries(split, server, discarded)).toEqual([renamed])
    })

    it('renames the row again after a whole rename was put back', () => {
      const discarded = staleAppSecretEntries([renamed], server, everything)
      const reverted = revertAppSecretEntries([renamed], server, everything)
      expect(restoreAppSecretEntries(reverted, server, discarded)).toEqual([renamed])
    })

    it('brings back a new row where it was, a staged delete and an edit', () => {
      const client = [
        row('A', {
          dev: { ...secret('d1', 'A', '1'), stagedForDelete: true } as SecretType,
          staging: secret('s1', 'A', 'edited'),
          prod: secret('p1', 'A', '3'),
        }),
        { ...row('NEW', { dev: secret('new-d', 'NEW', 'v') }), id: 'client-row' },
      ]
      const discarded = staleAppSecretEntries(client, server, everything)
      expect(discarded).toHaveLength(3)
      const reverted = revertAppSecretEntries(client, server, everything)
      expect(reverted).toEqual([server[0]])
      expect(restoreAppSecretEntries(reverted, server, discarded)).toEqual(client)
    })

    it('restores one discard without touching a later one', () => {
      const client = [row('A', { dev: secret('d1', 'A', 'x'), staging: secret('s1', 'A', 'y'), prod: secret('p1', 'A', '3') })]
      const first = staleAppSecretEntries(client, server, byEnv('dev'))
      const afterFirst = revertAppSecretEntries(client, server, byEnv('dev'))
      const afterSecond = revertAppSecretEntries(afterFirst, server, byEnv('staging'))
      expect(afterSecond[0]).toBe(server[0])
      const [restored] = restoreAppSecretEntries(afterSecond, server, first)
      expect(restored.envs.map((e) => e.secret?.value ?? null)).toEqual(['x', '2', '3'])
    })
  })
})

describe('snapshotHasDeploy', () => {
  const at = (id: string, key: string, updatedAt: string) =>
    secret(id, key, '1', { updatedAt } as Partial<SecretType>)
  const before = [row('A', { dev: at('d1', 'A', 't1') }), row('B', { dev: at('d2', 'B', 't1') })]
  const deployed = {
    createdIds: ['saved-1'],
    deletedIds: ['d2'],
    editedAt: new Map([['d1', 't1']]),
  }

  it('turns down the snapshot from before the deploy when it is published again', () => {
    expect(snapshotHasDeploy(before, deployed)).toBe(false)
  })

  it('waits for every change to show', () => {
    const created = row('C', { dev: at('saved-1', 'C', 't2') })
    expect(snapshotHasDeploy([before[0], created], deployed)).toBe(false)
    expect(snapshotHasDeploy([row('A', { dev: at('d1', 'A', 't2') }), before[1], created], deployed)).toBe(false)
    expect(snapshotHasDeploy([row('A', { dev: at('d1', 'A', 't2') })], deployed)).toBe(false)
  })

  it('accepts the snapshot with the new secret, without the deleted one, and the edit by its timestamp alone', () => {
    // A sealed value reads the same before and after, so only updatedAt tells
    const after = [row('A', { dev: at('d1', 'A', 't2') }), row('C', { dev: at('saved-1', 'C', 't2') })]
    expect(snapshotHasDeploy(after, deployed)).toBe(true)
  })

  it('accepts an edited secret that someone else has since deleted', () => {
    expect(snapshotHasDeploy([], { createdIds: [], deletedIds: [], editedAt: new Map([['d1', 't1']]) })).toBe(true)
  })
})

describe('carryRowKeys', () => {
  const ownKey = (id: string) => id
  const deployed = (key: string, id: string) => row(key, { dev: secret(id, key, '1') })

  it('hands a new row and a renamed row the keys they had, and leaves the rest alone', () => {
    const before = [
      deployed('A', 'd1'),
      { ...deployed('B', 'd2'), key: 'RENAMED' },
      { ...deployed('NEW', 'new'), id: 'client-row' },
    ]
    const after = [deployed('A', 'd1'), deployed('RENAMED', 'd2'), deployed('NEW', 'saved')]
    expect([...carryRowKeys(before, after, ownKey)]).toEqual([
      ['app-RENAMED', 'app-B'],
      ['app-NEW', 'client-row'],
    ])
  })

  it('keeps carrying a key through a later deploy', () => {
    const earlier = new Map([['app-NEW', 'client-row']])
    const before = [{ ...deployed('NEW', 'saved'), key: 'NEWER' }]
    const carried = carryRowKeys(before, [deployed('NEWER', 'saved')], (id) => earlier.get(id) ?? id)
    expect([...carried]).toEqual([['app-NEWER', 'client-row']])
  })

  it('carries nothing rather than give two rows one key', () => {
    // Someone else re-created the old key while it was being renamed here
    const before = [{ ...deployed('A', 'd1'), key: 'B' }]
    const after = [deployed('B', 'd1'), deployed('A', 'theirs')]
    expect(carryRowKeys(before, after, ownKey).size).toBe(0)
  })
})

describe('flattenAppSecrets', () => {
  it('emits one secret per present env value with its env and own key', () => {
    const rows = [
      { ...row('B', { dev: secret('d1', 'B', '1'), prod: secret('p1', 'A', '2') }), key: 'B' },
    ]
    const flat = flattenAppSecrets(rows)
    expect(flat.map((s) => [s.id, s.key, s.environment.id])).toEqual([
      ['d1', 'B', 'dev'],
      ['p1', 'A', 'prod'],
    ])
  })

  it('falls back to the row key for values without one', () => {
    const rows = [row('A', { dev: secret('new-1', '', '1') })]
    expect(flattenAppSecrets(rows)[0].key).toBe('A')
  })
})

describe('duplicateKeyRowIds', () => {
  it('flags rows that share a key within the same env only', () => {
    const rows = [
      row('A', { dev: secret('d1', 'A', '1') }),
      { ...row('A', { prod: secret('p1', 'A', '2') }), id: 'other-env' },
      { ...row('A', { dev: secret('new-1', 'A', '') }), id: 'same-env' },
    ]
    expect([...duplicateKeyRowIds(rows)].sort()).toEqual(['app-A', 'same-env'])
  })

  it("flags rows that reuse a dynamic secret's key in the same env and folder", () => {
    const rows = [
      row('AWS_ACCESS_KEY_ID', { dev: secret('d1', 'AWS_ACCESS_KEY_ID', 'x') }),
      row('DATABASE_URL', { dev: secret('d2', 'DATABASE_URL', 'y') }),
    ]
    const dynamicKeys = [{ envId: 'dev', path: '/', key: 'AWS_ACCESS_KEY_ID' }]
    expect([...duplicateKeyRowIds(rows, dynamicKeys)]).toEqual(['app-AWS_ACCESS_KEY_ID'])
  })

  it("does not flag a dynamic secret's key in another env or folder", () => {
    const rows = [row('AWS_ACCESS_KEY_ID', { dev: secret('d1', 'AWS_ACCESS_KEY_ID', 'x') })]
    const dynamicKeys = [
      { envId: 'prod', path: '/', key: 'AWS_ACCESS_KEY_ID' },
      { envId: 'dev', path: '/backend', key: 'AWS_ACCESS_KEY_ID' },
    ]
    expect(duplicateKeyRowIds(rows, dynamicKeys).size).toBe(0)
  })

  it('does not flag the same key in different folders', () => {
    const rows = [
      row('A', { dev: secret('d1', 'A', '1') }),
      {
        ...row('A', { dev: secret('d2', 'A', '2', { path: '/backend' }) }),
        id: 'nested',
        path: '/backend',
      },
    ]
    expect(duplicateKeyRowIds(rows).size).toBe(0)
  })

  it('ignores values staged for deletion', () => {
    const rows = [
      row('A', { dev: { ...secret('d1', 'A', '1'), stagedForDelete: true } as SecretType }),
      { ...row('A', { dev: secret('new-1', 'A', '') }), id: 'replacement' },
    ]
    expect(duplicateKeyRowIds(rows).size).toBe(0)
  })
})

describe('groupRotatingRows', () => {
  const rotating = (id: string, key: string, rid: string) =>
    secret(id, key, 'v', { rotatingSecretId: rid } as Partial<SecretType>)

  it('groups rows sharing a rotating secret across envs, in input order', () => {
    const rows = [
      row('A', { dev: secret('d1', 'A', '1') }),
      row('USER', { dev: rotating('d2', 'USER', 'rs-dev'), prod: rotating('p2', 'USER', 'rs-prod') }),
      row('B', { dev: secret('d3', 'B', '1') }),
      row('PASS', { prod: rotating('p3', 'PASS', 'rs-prod') }),
    ]
    const items = groupRotatingRows(rows, new Set(['dev', 'staging', 'prod']))

    expect(items.map((item) => item.kind)).toEqual(['single', 'group', 'single'])
    const group = items[1] as Extract<(typeof items)[number], { kind: 'group' }>
    expect(group.appSecrets.map((r) => r.key)).toEqual(['USER', 'PASS'])
    expect(group.groupKey).toBe('rs-dev,rs-prod')
  })

  it('only follows rotation in the given envs', () => {
    const rows = [row('PASS', { prod: rotating('p3', 'PASS', 'rs-prod') })]
    expect(groupRotatingRows(rows, new Set(['dev']))[0].kind).toBe('single')
  })
})
