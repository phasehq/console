import {
  KeyAt,
  ReferenceContext,
  ReferenceOrigin,
  buildInsertionText,
  computeSuggestions,
  getActiveReferenceToken,
  getSuggestionUrl,
} from '@/utils/secretReferences'

const context = (overrides: Partial<ReferenceContext> = {}): ReferenceContext => ({
  teamSlug: 'team',
  appId: 'app-1',
  envIds: { development: 'dev', production: 'prod' },
  secretIdLookup: {},
  secretKeys: [],
  envSecretKeys: {},
  envRootKeys: {},
  envNames: ['Development', 'Production'],
  folderPaths: [],
  folderSecretKeys: {},
  envFolderKeys: {},
  orgApps: [],
  deletedKeys: [],
  ...overrides,
})

/** The caller's own copy: `envId path key` per line */
const copyOf = (lines: string[]): ReferenceContext['keysOf'] => {
  const byEnv = new Map<string, KeyAt[]>()
  for (const line of lines) {
    const [envId, path, key] = line.split(' ')
    byEnv.set(envId, [...(byEnv.get(envId) ?? []), ...(key ? [{ path, key }] : [])])
  }
  return (envId) => byEnv.get(envId)
}

/** What the dropdown offers with the cursor at the end of `value` */
const offered = (value: string, ctx: ReferenceContext, origin?: ReferenceOrigin) =>
  computeSuggestions(getActiveReferenceToken(value, value.length)!, ctx, origin).map(
    (suggestion) => suggestion.insertText
  )

/** Types `value`, then accepts the suggestion labelled by each of `picks` in turn */
const accept = (
  value: string,
  picks: string[],
  ctx: ReferenceContext,
  origin?: ReferenceOrigin
) => {
  for (const pick of picks) {
    const token = getActiveReferenceToken(value, value.length)!
    const suggestion = computeSuggestions(token, ctx, origin).find((s) => s.label === pick)
    if (!suggestion) throw new Error(`"${pick}" is not offered after ${value}`)
    value = buildInsertionText(suggestion, token, value).newValue
  }
  return value
}

describe('a folder is written as it is named', () => {
  // The org-wide list, with folders as they are stored
  const listed = context({
    envRootKeys: { production: ['DB_HOST'] },
    envFolderKeys: { production: { Payments: ['STRIPE_KEY'], 'Payments/EU': ['IBAN'] } },
    orgApps: [
      {
        id: 'app-2',
        name: 'billing',
        envNames: ['Production'],
        envIds: { production: 'billing-prod' },
        envSecretKeys: { production: ['LEDGER_URL'] },
        envRootKeys: {},
        folderKeys: { API: ['LEDGER_URL'] },
        envFolderKeys: { production: { API: ['LEDGER_URL'] } },
        secretIdLookup: { 'production|/API|LEDGER_URL': 'ledger-id' },
      },
    ],
  })

  test('in a reference into another environment', () => {
    expect(offered('${Production.', listed)).toEqual(['Production.Payments/', 'Production.DB_HOST'])
    expect(accept('${Production.', ['Payments/', 'STRIPE_KEY'], listed)).toBe(
      '${Production.Payments/STRIPE_KEY}'
    )
  })

  test('in a reference into another app', () => {
    expect(accept('${billing::Production.', ['API/', 'LEDGER_URL'], listed)).toBe(
      '${billing::Production.API/LEDGER_URL}'
    )
  })

  test('whatever case it is typed in', () => {
    expect(offered('${Production.pay', listed)).toEqual(['Production.Payments/'])
    // Typed in lowercase all the way: accepting a key puts the folder right
    expect(accept('${Production.payments/STR', ['STRIPE_KEY'], listed)).toBe(
      '${Production.Payments/STRIPE_KEY}'
    )
    expect(accept('${billing::Production.api/', ['LEDGER_URL'], listed)).toBe(
      '${billing::Production.API/LEDGER_URL}'
    )
  })

  test('and two folders that differ only in case stay apart', () => {
    const both = context({
      envFolderKeys: { production: { payments: ['OLD_KEY'], Payments: ['STRIPE_KEY'] } },
    })
    expect(offered('${Production.', both)).toEqual(['Production.Payments/', 'Production.payments/'])
    expect(offered('${Production.payments/', both)).toEqual(['Production.payments/OLD_KEY'])
    expect(offered('${Production.Payments/', both)).toEqual(['Production.Payments/STRIPE_KEY'])
    // Neither is spelled this way, so both are meant
    expect(offered('${Production.PAYMENTS/', both)).toEqual([
      'Production.Payments/STRIPE_KEY',
      'Production.payments/OLD_KEY',
    ])
  })

  test('so that Ctrl+Enter opens the folder and the secret that exist', () => {
    const ctx = { ...listed, secretIdLookup: { 'production|/Payments|STRIPE_KEY': 'stripe-id' } }
    const token = getActiveReferenceToken('${Production.payments/', 22)!
    const [key] = computeSuggestions(token, ctx)
    expect(getSuggestionUrl(key, token, ctx)).toBe(
      '/team/apps/app-1/Payments?envs=prod&secret=stripe-id'
    )

    const crossApp = getActiveReferenceToken('${billing::Production.api/', 26)!
    const [ledger] = computeSuggestions(crossApp, ctx)
    expect(getSuggestionUrl(ledger, crossApp, ctx)).toBe(
      '/team/apps/app-2/API?envs=billing-prod&secret=ledger-id'
    )
  })
})

describe('folders inside folders', () => {
  const nested = context({
    envFolderKeys: {
      production: { 'services/api': ['API_KEY'], 'services/api/v2': ['V2_KEY'], infra: ['REGION'] },
    },
    orgApps: [
      {
        id: 'app-2',
        name: 'billing',
        envNames: ['Production'],
        envIds: { production: 'billing-prod' },
        envSecretKeys: { production: ['DEEP_KEY'] },
        envRootKeys: {},
        folderKeys: {},
        envFolderKeys: { production: { 'a/b/c': ['DEEP_KEY'] } },
        secretIdLookup: {},
      },
    ],
  })

  test('a folder that only holds folders is offered at the root, in alphabetical order', () => {
    expect(offered('${Production.', nested)).toEqual(['Production.infra/', 'Production.services/'])
  })

  test('each level leads to the next, down to the keys', () => {
    expect(offered('${Production.services/', nested)).toEqual(['Production.services/api/'])
    expect(offered('${Production.services/api/', nested)).toEqual([
      'Production.services/api/API_KEY',
      'Production.services/api/v2/',
    ])
    expect(accept('${Production.', ['services/', 'api/', 'v2/', 'V2_KEY'], nested)).toBe(
      '${Production.services/api/v2/V2_KEY}'
    )
  })

  test('in another app as well', () => {
    expect(accept('${billing::Production.', ['a/', 'b/', 'c/', 'DEEP_KEY'], nested)).toBe(
      '${billing::Production.a/b/c/DEEP_KEY}'
    )
  })

  test('a path started with a slash keeps it', () => {
    expect(offered('${Production./', nested)).toEqual([
      'Production./infra/',
      'Production./services/',
    ])
    expect(accept('${Production./services/', ['api/', 'API_KEY'], nested)).toBe(
      '${Production./services/api/API_KEY}'
    )
  })
})

describe("with the caller's own copy of each environment", () => {
  const held = context({
    // The org-wide list is older, and lists what the copy no longer has
    envRootKeys: { production: ['GONE_FROM_PRODUCTION'] },
    folderSecretKeys: { backend: ['ONLY_IN_PRODUCTION'] },
    secretKeys: ['A_KEY_OF_THE_OPEN_FOLDER'],
    keysOf: copyOf([
      'dev / DB_HOST',
      'dev / DB_PORT',
      'dev /backend REDIS_URL',
      'dev /backend WORKERS',
      'dev /backend/jobs QUEUE',
      'prod / DB_HOST',
      'prod /Payments STRIPE_KEY',
      'prod /backend ONLY_IN_PRODUCTION',
    ]),
  })
  const atRoot: ReferenceOrigin = { key: 'DB_URL', envId: 'dev', path: '/' }
  const inBackend: ReferenceOrigin = { key: 'REDIS_URL', envId: 'dev', path: '/backend' }
  const keysOffered = (value: string, origin: ReferenceOrigin) =>
    computeSuggestions(getActiveReferenceToken(value, value.length)!, held, origin)
      .filter((suggestion) => suggestion.type === 'key')
      .map((suggestion) => suggestion.insertText)

  test("a bare key is one at the root of the value's own environment", () => {
    expect(keysOffered('${', atRoot)).toEqual(['DB_HOST', 'DB_PORT'])
    expect(keysOffered('${', { ...atRoot, key: 'DB_HOST' })).toEqual(['DB_PORT'])
  })

  test('a key beside the value in a folder is offered with that folder', () => {
    expect(keysOffered('${', inBackend)).toEqual(['backend/WORKERS', 'DB_HOST', 'DB_PORT'])
    expect(accept('${WOR', ['backend/WORKERS'], held, inBackend)).toBe('${backend/WORKERS}')
  })

  test("folders and their keys are those of the value's own environment", () => {
    expect(offered('${back', held, atRoot)).toEqual(['backend/', 'backend/jobs/'])
    expect(offered('${backend/', held, atRoot)).toEqual([
      'backend/REDIS_URL',
      'backend/WORKERS',
      'backend/jobs/',
    ])
    expect(offered('${backend/', held, { ...atRoot, envId: 'prod' })).toEqual([
      'backend/ONLY_IN_PRODUCTION',
    ])
  })

  test('another environment is read from the copy, not from the older list', () => {
    expect(offered('${Production.', held, atRoot)).toEqual([
      'Production.backend/',
      'Production.Payments/',
      'Production.DB_HOST',
    ])
  })

  test('an environment the copy does not hold falls back to the list', () => {
    const pending = { ...held, keysOf: copyOf(['dev / DB_HOST']) }
    expect(offered('${Production.', pending, atRoot)).toEqual(['Production.GONE_FROM_PRODUCTION'])
  })

  test('an environment the copy holds with nothing in it offers nothing', () => {
    const empty = { ...held, keysOf: copyOf(['dev / DB_HOST', 'prod']) }
    expect(offered('${Production.', empty, atRoot)).toEqual([])
  })

  test("Ctrl+Enter opens a local suggestion in the value's environment", () => {
    const ctx = { ...held, secretIdLookup: { 'development|/backend|WORKERS': 'workers-id' } }
    const token = getActiveReferenceToken('${', 2)!
    const urlOf = (insertText: string) =>
      getSuggestionUrl(
        computeSuggestions(token, ctx, inBackend).find((s) => s.insertText === insertText)!,
        token,
        ctx,
        inBackend
      )
    // No single environment is shown, so only the value says which one
    expect(ctx.envId).toBeUndefined()
    expect(urlOf('DB_HOST')).toBe('/team/apps/app-1?envs=dev')
    expect(urlOf('backend/WORKERS')).toBe('/team/apps/app-1/backend?envs=dev&secret=workers-id')
    expect(urlOf('backend/')).toBe('/team/apps/app-1/backend?envs=dev')
  })
})
