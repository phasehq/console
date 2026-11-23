import { KeyState, ReferenceContext, validateSecretReferences } from '@/utils/secretReferences'

/** Keys the caller's copy holds, as `envId path key`; the last word of a line may mark a staged deletion */
const copyOf = (lines: string[]): ReferenceContext['keyStateAt'] => {
  const states = new Map<string, KeyState>()
  const envs = new Set<string>()
  for (const line of lines) {
    const [envId, path, key, deleted] = line.split(' ')
    envs.add(envId)
    states.set(`${envId} ${path} ${key}`, deleted ? 'deleted' : 'present')
  }
  return (envId, path, key) =>
    envId && envs.has(envId) ? states.get(`${envId} ${path} ${key}`) ?? 'missing' : undefined
}

const context = (keyStateAt: ReferenceContext['keyStateAt']): ReferenceContext => ({
  teamSlug: 'team',
  appId: 'app',
  envIds: { development: 'dev', staging: 'stg', production: 'prod' },
  secretIdLookup: {},
  // What the open folder holds: the path-blind fallback
  secretKeys: ['LOCAL_ONLY'],
  envSecretKeys: { production: ['FROM_ORG_DATA'] },
  envRootKeys: {},
  envNames: ['Development', 'Staging', 'Production'],
  folderPaths: [],
  folderSecretKeys: {},
  envFolderKeys: {},
  orgApps: [],
  deletedKeys: [],
  keyStateAt,
})

const row = (key: string, envId: string, envName: string, value: string) => ({
  key,
  envs: [{ env: { id: envId, name: envName }, secret: { value } }],
})

describe('validateSecretReferences with a copy to look keys up in', () => {
  const held = copyOf([
    'dev / HOST',
    'dev /backend PORT',
    'dev /backend/db PASSWORD',
    'dev / GOING deleted',
    'stg / HOST',
    'stg /backend PORT',
  ])

  test('a bare key is looked up at the root, whatever folder is open', () => {
    const errors = validateSecretReferences(
      [row('URL', 'dev', 'Development', 'https://${HOST}')],
      context(held)
    )
    expect(errors).toEqual([])
  })

  test('a key that is only in a folder is not found by its bare name', () => {
    const errors = validateSecretReferences(
      [row('URL', 'dev', 'Development', '${PORT}')],
      context(held)
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ secretKey: 'URL', reference: '${PORT}' })
    expect(errors[0].error).toContain('does not exist')
  })

  test('a path in the reference names the folder, with or without a leading slash', () => {
    const errors = validateSecretReferences(
      [
        row('A', 'dev', 'Development', '${backend/PORT}'),
        row('B', 'dev', 'Development', '${/backend/PORT}'),
        row('C', 'dev', 'Development', '${backend/db/PASSWORD}'),
      ],
      context(held)
    )
    expect(errors).toEqual([])
  })

  test('the lookup is in the value own environment', () => {
    const errors = validateSecretReferences(
      [row('C', 'stg', 'Staging', '${backend/db/PASSWORD}')],
      context(held)
    )
    expect(errors).toHaveLength(1)
    expect(errors[0].envName).toBe('Staging')
  })

  test('a key staged for deletion is reported as such, and marked', () => {
    const errors = validateSecretReferences(
      [row('URL', 'dev', 'Development', '${GOING}')],
      context(held)
    )
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toContain('staged for deletion')
    expect(errors[0].deleted).toBe(true)
  })

  test('a missing key is not marked as a deletion', () => {
    const [error] = validateSecretReferences(
      [row('URL', 'dev', 'Development', '${NOPE}')],
      context(held)
    )
    expect(error.deleted).toBeUndefined()
  })

  test('a cross-environment reference is looked up at its path in that environment', () => {
    const errors = validateSecretReferences(
      [
        row('OK', 'dev', 'Development', '${staging.HOST} ${staging.backend/PORT}'),
        row('BAD', 'dev', 'Development', '${staging.PORT}'),
      ],
      context(held)
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ secretKey: 'BAD', reference: '${staging.PORT}' })
  })

  test('an environment the copy does not hold falls back to the organisation key data', () => {
    const errors = validateSecretReferences(
      [
        row('OK', 'dev', 'Development', '${production.FROM_ORG_DATA}'),
        row('BAD', 'dev', 'Development', '${production.UNKNOWN}'),
      ],
      context(held)
    )
    expect(errors).toHaveLength(1)
    expect(errors[0].secretKey).toBe('BAD')
  })

  test('without a copy the open folder keys decide, as before', () => {
    const errors = validateSecretReferences(
      [
        row('OK', 'dev', 'Development', '${LOCAL_ONLY}'),
        row('BAD', 'dev', 'Development', '${HOST}'),
      ],
      context(undefined)
    )
    expect(errors).toHaveLength(1)
    expect(errors[0].secretKey).toBe('BAD')
  })
})
