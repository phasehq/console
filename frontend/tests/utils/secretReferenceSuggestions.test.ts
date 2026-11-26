import {
  KeyAt,
  ReferenceContext,
  ReferenceOrigin,
  buildInsertionText,
  computeSuggestions,
  getActiveReferenceToken,
  getSuggestionUrl,
  validateSecretReferences,
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

describe('a closing brace further on in the value', () => {
  const ctx = context({ secretKeys: ['DB_HOST', 'DB_PORT'] })
  const acceptAt = (value: string, cursor: number, pick: string) => {
    const token = getActiveReferenceToken(value, cursor)!
    const suggestion = computeSuggestions(token, ctx).find((s) => s.label === pick)!
    return buildInsertionText(suggestion, token, value).newValue
  }

  test('is not the end of the reference being typed', () => {
    const json = '{"host": "${DB_"}'
    const token = getActiveReferenceToken(json, 15)!
    expect(token.insideClosedRef).toBe(false)
    // So what is typed still filters
    expect(computeSuggestions(token, ctx).map((s) => s.label)).toEqual(['DB_HOST', 'DB_PORT'])
  })

  test('and stays where it is when a suggestion is accepted', () => {
    expect(acceptAt('{"host": "${DB_"}', 15, 'DB_HOST')).toBe('{"host": "${DB_HOST}"}')
    expect(acceptAt('${DB_ and {braces}', 5, 'DB_PORT')).toBe('${DB_PORT} and {braces}')
    expect(acceptAt("export A='${DB_' B='{}'", 15, 'DB_HOST')).toBe("export A='${DB_HOST}' B='{}'")
  })

  test('while the rest of a reference that is closed is still replaced', () => {
    expect(getActiveReferenceToken('${DB_HOST}', 5)!.insideClosedRef).toBe(true)
    expect(acceptAt('{"host": "${DB_HOST}"}', 15, 'DB_PORT')).toBe('{"host": "${DB_PORT}"}')
  })
})

describe('an app name with spaces or quotes in it', () => {
  const named = (id: string, name: string) => ({
    id,
    name,
    envNames: ['Production'],
    envIds: { production: `${id}-prod` },
    envSecretKeys: { production: ['LEDGER_URL'] },
    envRootKeys: { production: ['LEDGER_URL'] },
    folderKeys: {},
    envFolderKeys: {},
    secretIdLookup: {},
  })
  const ctx = context({
    orgApps: [
      named('app-2', 'Billing API'),
      named('app-3', `Tom's "edge" API`),
      named('app-4', 'ledger'),
    ],
  })
  const spaced = '${Billing API::Production.LEDGER_URL}'
  const quoted = `\${Tom's "edge" API::Production.LEDGER_URL}`

  /** The reference under the cursor when it sits right after `upTo` */
  const tokenAfter = (value: string, upTo: string) => {
    if (!value.startsWith(upTo)) throw new Error(`${value} does not start with ${upTo}`)
    return getActiveReferenceToken(value, upTo.length)!
  }
  const acceptAfter = (value: string, upTo: string, pick: string) => {
    const token = tokenAfter(value, upTo)
    const suggestion = computeSuggestions(token, ctx).find((s) => s.label === pick)
    if (!suggestion) throw new Error(`"${pick}" is not offered after ${upTo}`)
    return buildInsertionText(suggestion, token, value).newValue
  }

  test('is part of the reference the cursor is in', () => {
    expect(tokenAfter(spaced, '${Bill').insideClosedRef).toBe(true)
    expect(tokenAfter(quoted, '${Tom').insideClosedRef).toBe(true)
    expect(tokenAfter(quoted, `\${Tom's "ed`).insideClosedRef).toBe(true)
  })

  test('so accepting that app leaves the reference as it was', () => {
    expect(acceptAfter(spaced, '${Bill', 'Billing API')).toBe(spaced)
    expect(acceptAfter(quoted, '${Tom', `Tom's "edge" API`)).toBe(quoted)
  })

  test('and accepting another app replaces the name alone', () => {
    expect(acceptAfter(spaced, '${Bill', 'ledger')).toBe('${ledger::Production.LEDGER_URL}')
    expect(acceptAfter(quoted, `\${Tom's "ed`, 'Billing API')).toBe(spaced)
    expect(acceptAfter(`{"url": "${spaced}"}`, '{"url": "${Bill', 'ledger')).toBe(
      '{"url": "${ledger::Production.LEDGER_URL}"}'
    )
  })

  test('while a brace that belongs to something else is still left alone', () => {
    // What follows the `::` cannot be the rest of a reference
    expect(acceptAfter('{"app": "${Bill", "note": "a::b"}', '{"app": "${Bill', 'Billing API')).toBe(
      '{"app": "${Billing API::", "note": "a::b"}'
    )
    // The brace closes another reference
    const two = `{"a": "\${Bill", "b": "${spaced}"}`
    expect(tokenAfter(two, '{"a": "${Bill').insideClosedRef).toBe(false)
    // A name does not run over a line break
    expect(tokenAfter('${Bill\nledger::Production.LEDGER_URL}', '${Bill').insideClosedRef).toBe(
      false
    )
    // Past the name, a quote is not part of a reference
    expect(
      tokenAfter('{"app": "${Billing API::Prod"}', '{"app": "${Billing API::Prod').insideClosedRef
    ).toBe(false)
  })
})

describe('a reference by app name', () => {
  const billing = {
    id: 'app-2',
    name: 'billing',
    envNames: ['Production'],
    envIds: { production: 'billing-prod' },
    envSecretKeys: { production: ['LEDGER_URL'] },
    envRootKeys: { production: ['LEDGER_URL'] },
    folderKeys: {},
    envFolderKeys: {},
    secretIdLookup: {},
  }
  const inDev = (value: string) => [
    { key: 'URL', envs: [{ env: { id: 'dev', name: 'Development' }, secret: { value } }] },
  ]
  const errorsFor = (value: string, ctx: ReferenceContext) =>
    validateSecretReferences(inDev(value), ctx).map((error) => error.error)

  test('to this app is checked like one into another of its environments', () => {
    const ctx = context({
      appName: 'storefront',
      orgApps: [billing],
      keyStateAt: (envId, path, key) =>
        envId === 'prod' ? (path === '/' && key === 'DB_HOST' ? 'present' : 'missing') : undefined,
    })
    expect(errorsFor('${storefront::Production.DB_HOST}', ctx)).toEqual([])
    expect(errorsFor('${Storefront::production.NOT_THERE}', ctx)).toEqual([
      'Referenced key "NOT_THERE" does not exist in "production"',
    ])
    expect(errorsFor('${storefront::Preview.DB_HOST}', ctx)).toEqual([
      'Referenced environment "Preview" does not exist in app "storefront"',
    ])
  })

  test('that two apps share is flagged: it resolves to neither', () => {
    const ctx = context({ appName: 'storefront', orgApps: [], ambiguousAppNames: ['billing'] })
    expect(errorsFor('${Billing::Production.LEDGER_URL}', ctx)).toEqual([
      'Referenced app "Billing" is ambiguous: more than one app in this organisation has that name',
    ])
  })

  test('is left alone until the apps of the organisation have been read', () => {
    const unread = context({ appName: 'storefront', orgApps: [], orgAppsKnown: false })
    expect(errorsFor('${billing::Production.LEDGER_URL}', unread)).toEqual([])
    const read = context({ appName: 'storefront', orgApps: [], orgAppsKnown: true })
    expect(errorsFor('${billing::Production.LEDGER_URL}', read)).toEqual([
      'Referenced app "billing" does not exist in this organisation',
    ])
  })
})

describe('an environment there is nothing to tell about', () => {
  const inDev = [
    {
      key: 'URL',
      envs: [
        { env: { id: 'dev', name: 'Development' }, secret: { value: '${Production.DB_HOST}' } },
      ],
    },
  ]

  test('is not judged: neither a copy of it nor a list of its keys', () => {
    expect(validateSecretReferences(inDev, context())).toEqual([])
  })

  test('while a list that lacks the key still flags the reference', () => {
    const listed = context({ envSecretKeys: { production: [] } })
    expect(validateSecretReferences(inDev, listed)).toHaveLength(1)
  })
})
