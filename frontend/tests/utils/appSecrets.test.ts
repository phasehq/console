import { ApiSecretTypeChoices, EnvironmentType, SecretType } from '@/apollo/graphql'
import { AppSecret } from '@/app/[team]/apps/[app]/types'
import {
  appSecretRowIsEdited,
  buildAppSecretRows,
  dirtyEnvIds,
  duplicateKeyRowIds,
  envSecretsEqual,
  flattenAppSecrets,
  groupRotatingRows,
  mergeAppSecretsUpdate,
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
