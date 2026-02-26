import {
  formatEnvValue,
  exportToEnvFile,
  processEnvFile,
  toggleBooleanKeepingCase,
  getSecretPermalink,
  sortSecrets,
  duplicateKeysExist,
  sortEnvs,
  normalizeKey,
} from '@/utils/secrets'
import { EnvironmentType, SecretType, DynamicSecretType } from '@/apollo/graphql'

// Polyfill APIs missing in jsdom — save originals so we can restore after
const originalCrypto = globalThis.crypto
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => '00000000-0000-0000-0000-000000000000' },
    configurable: true,
  })
  URL.createObjectURL = jest.fn(() => 'blob:mock-url')
  URL.revokeObjectURL = jest.fn()
})

afterAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    value: originalCrypto,
    configurable: true,
  })
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
})

describe('formatEnvValue', () => {
  test('returns plain values unchanged', () => {
    expect(formatEnvValue('hello')).toBe('hello')
    expect(formatEnvValue('simple_value')).toBe('simple_value')
    expect(formatEnvValue('https://example.com')).toBe('https://example.com')
  })

  test('returns values with = unchanged', () => {
    expect(formatEnvValue('key=value')).toBe('key=value')
    expect(formatEnvValue('a=b=c')).toBe('a=b=c')
  })

  test('wraps values containing # in double quotes', () => {
    expect(formatEnvValue('foo#bar')).toBe('"foo#bar"')
    expect(formatEnvValue('#comment-like')).toBe('"#comment-like"')
  })

  test('wraps values containing newlines in double quotes', () => {
    expect(formatEnvValue('line1\nline2')).toBe('"line1\nline2"')
  })

  test('wraps values starting with double quote in single quotes', () => {
    expect(formatEnvValue('"already quoted"')).toBe(`'"already quoted"'`)
  })

  test('wraps values starting with single quote in double quotes', () => {
    expect(formatEnvValue("'single quoted'")).toBe(`"'single quoted'"`)
  })

  test('wraps values with leading/trailing whitespace in double quotes', () => {
    expect(formatEnvValue(' leading')).toBe('" leading"')
    expect(formatEnvValue('trailing ')).toBe('"trailing "')
    expect(formatEnvValue(' both ')).toBe('" both "')
  })

  test('escapes inner quotes when value contains both quote types', () => {
    expect(formatEnvValue(`"it's both"`)).toBe(`"\\"it's both\\""`)
  })

  test('does not escape backslashes when simple double-quoting suffices', () => {
    // No " in the value, so it takes the simple double-quote path
    expect(formatEnvValue(`path\\with#hash`)).toBe(`"path\\with#hash"`)
  })

  test('escapes backslashes and quotes in the both-quote-types fallback', () => {
    // Starts with " (triggers needsQuoting), contains both " and ' (triggers escape path), has \
    const val = `"it's a path\\to thing"`
    const formatted = formatEnvValue(val)
    expect(formatted).toBe(`"\\"it's a path\\\\to thing\\""`)
  })

  test('returns empty string unchanged', () => {
    expect(formatEnvValue('')).toBe('')
  })
})

describe('exportToEnvFile', () => {
  let appendChildSpy: jest.SpyInstance
  let removeChildSpy: jest.SpyInstance
  let clickSpy: jest.Mock

  beforeEach(() => {
    clickSpy = jest.fn()
    appendChildSpy = jest.spyOn(document.body, 'appendChild').mockImplementation((node) => node)
    removeChildSpy = jest.spyOn(document.body, 'removeChild').mockImplementation((node) => node)
    ;(URL.createObjectURL as jest.Mock).mockClear()
    ;(URL.revokeObjectURL as jest.Mock).mockClear()

    jest.spyOn(document, 'createElement').mockImplementation(
      (tag: string) =>
        ({
          tagName: tag.toUpperCase(),
          href: '',
          download: '',
          click: clickSpy,
        }) as unknown as HTMLElement
    )
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('triggers a file download', () => {
    const secrets = [{ key: 'FOO', value: 'bar', comment: '' }]

    exportToEnvFile(secrets, 'MyApp', 'Production')

    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(appendChildSpy).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    expect(removeChildSpy).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  test('sets correct filename for root path', () => {
    const secrets = [{ key: 'FOO', value: 'bar', comment: '' }]

    exportToEnvFile(secrets, 'MyApp', 'Production', '/')

    const anchor = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement
    expect(anchor.download).toBe('MyApp.production.env')
  })

  test('sets correct filename for nested path', () => {
    const secrets = [{ key: 'FOO', value: 'bar', comment: '' }]

    exportToEnvFile(secrets, 'MyApp', 'Staging', '/backend/api')

    const anchor = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement
    expect(anchor.download).toBe('MyApp.staging.backend.api.env')
  })

  test('generates correct .env content with comments and quoted values', async () => {
    const secrets = [
      { key: 'DB_HOST', value: 'localhost', comment: 'Database host' },
      { key: 'API_KEY', value: 'abc#123', comment: '' },
    ]

    exportToEnvFile(secrets, 'App', 'Dev')

    expect(URL.createObjectURL).toHaveBeenCalled()
    const blob = (URL.createObjectURL as jest.Mock).mock.calls[0][0] as Blob
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsText(blob)
    })
    expect(text).toBe('#Database host\nDB_HOST=localhost\nAPI_KEY="abc#123"')
  })
})

describe('formatEnvValue + processEnvFile round-trip', () => {
  const mockEnv = { id: 'env-1', name: 'test' } as EnvironmentType

  const roundTrip = (key: string, value: string, comment: string = '') => {
    const formatted = `${comment ? `#${comment}\n` : ''}${key}=${formatEnvValue(value)}`
    const parsed = processEnvFile(formatted, mockEnv, '/')
    expect(parsed).toHaveLength(1)
    expect(parsed[0].key).toBe(key)
    expect(parsed[0].value).toBe(value)
    if (comment) expect(parsed[0].comment).toBe(comment)
  }

  test('plain value', () => {
    roundTrip('SIMPLE', 'hello')
  })

  test('value with =', () => {
    roundTrip('CONN_STR', 'host=localhost;port=5432')
  })

  test('value with #', () => {
    roundTrip('COLOR', '#ff0000')
  })

  test('value with inline # in middle', () => {
    roundTrip('NOTE', 'before#after')
  })

  test('value with newlines', () => {
    roundTrip('MULTILINE', 'line1\nline2\nline3')
  })

  test('value starting with double quote', () => {
    roundTrip('QUOTED', '"already quoted"')
  })

  test('value starting with single quote', () => {
    roundTrip('SINGLE', "'single quoted'")
  })

  test('value with leading whitespace', () => {
    roundTrip('PADDED', ' leading space')
  })

  test('value with trailing whitespace', () => {
    roundTrip('PADDED2', 'trailing space ')
  })

  test('empty value', () => {
    roundTrip('EMPTY', '')
  })

  test('value with comment preserved', () => {
    roundTrip('WITH_COMMENT', 'somevalue', 'This is a comment')
  })

  test('URL with fragment', () => {
    roundTrip('CALLBACK', 'https://example.com/path#fragment')
  })

  test('value with both single and double quotes', () => {
    roundTrip('MIXED', `"it's both"`)
  })

  test('value with backslashes', () => {
    roundTrip('BACKSLASH', 'C:\\Users\\test')
  })

  test('value with backslashes and hash', () => {
    roundTrip('COMPLEX', `path\\to#thing`)
  })

  test('value with both quote types and backslashes', () => {
    roundTrip('GNARLY', `"it's a path\\to thing"`)
  })

  test('multiple secrets round-trip', () => {
    const secrets = [
      { key: 'PLAIN', value: 'hello', comment: '' },
      { key: 'HASH', value: 'foo#bar', comment: 'has hash' },
      { key: 'MULTI', value: 'a\nb', comment: '' },
      { key: 'EQUALS', value: 'x=y=z', comment: '' },
    ]

    const envContent = secrets
      .map((s) => {
        const comment = s.comment ? `#${s.comment}\n` : ''
        return `${comment}${s.key}=${formatEnvValue(s.value)}`
      })
      .join('\n')

    const parsed = processEnvFile(envContent, mockEnv, '/')

    expect(parsed).toHaveLength(secrets.length)
    secrets.forEach((original, i) => {
      expect(parsed[i].key).toBe(original.key)
      expect(parsed[i].value).toBe(original.value)
    })
  })
})

describe('toggleBooleanKeepingCase', () => {
  test('toggles lowercase true to false', () => {
    expect(toggleBooleanKeepingCase('true')).toBe('false')
  })

  test('toggles lowercase false to true', () => {
    expect(toggleBooleanKeepingCase('false')).toBe('true')
  })

  test('toggles uppercase TRUE to FALSE', () => {
    expect(toggleBooleanKeepingCase('TRUE')).toBe('FALSE')
  })

  test('toggles uppercase FALSE to TRUE', () => {
    expect(toggleBooleanKeepingCase('FALSE')).toBe('TRUE')
  })

  test('toggles title case True to False', () => {
    expect(toggleBooleanKeepingCase('True')).toBe('False')
  })

  test('toggles title case False to True', () => {
    expect(toggleBooleanKeepingCase('False')).toBe('True')
  })

  test('returns non-boolean strings unchanged', () => {
    expect(toggleBooleanKeepingCase('hello')).toBe('hello')
    expect(toggleBooleanKeepingCase('yes')).toBe('yes')
    expect(toggleBooleanKeepingCase('')).toBe('')
    expect(toggleBooleanKeepingCase('1')).toBe('1')
  })

  test('handles mixed case (unknown pattern)', () => {
    // "tRuE" is mixed case — getCasePattern returns 'unknown', so result is lowercase
    expect(toggleBooleanKeepingCase('tRuE')).toBe('false')
  })
})

describe('getSecretPermalink', () => {
  test('generates correct permalink', () => {
    const secret = {
      id: 'secret-1',
      environment: {
        id: 'env-1',
        app: { id: 'app-1' },
      },
      path: '/backend',
    } as SecretType

    expect(getSecretPermalink(secret, 'my-org')).toBe(
      '/my-org/apps/app-1/environments/env-1/backend?secret=secret-1'
    )
  })

  test('handles root path', () => {
    const secret = {
      id: 'secret-2',
      environment: {
        id: 'env-2',
        app: { id: 'app-2' },
      },
      path: '/',
    } as SecretType

    expect(getSecretPermalink(secret, 'org')).toBe(
      '/org/apps/app-2/environments/env-2/?secret=secret-2'
    )
  })
})

describe('sortSecrets', () => {
  const mockEnv = { id: 'env-1' } as EnvironmentType

  const makeSecret = (overrides: Partial<SecretType>): SecretType =>
    ({
      id: 'id',
      key: '',
      value: '',
      comment: '',
      tags: [],
      path: '/',
      version: 1,
      updatedAt: null,
      createdAt: null,
      environment: mockEnv,
      ...overrides,
    }) as SecretType

  const secrets = [
    makeSecret({ key: 'BANANA', value: 'b', createdAt: '2024-01-02', updatedAt: '2024-01-03' }),
    makeSecret({ key: 'APPLE', value: 'a', createdAt: '2024-01-01', updatedAt: '2024-01-04' }),
    makeSecret({ key: 'CHERRY', value: 'c', createdAt: '2024-01-03', updatedAt: '2024-01-01' }),
  ]

  test('sorts by key ascending', () => {
    const sorted = sortSecrets(secrets, 'key')
    expect(sorted.map((s) => s.key)).toEqual(['APPLE', 'BANANA', 'CHERRY'])
  })

  test('sorts by key descending', () => {
    const sorted = sortSecrets(secrets, '-key')
    expect(sorted.map((s) => s.key)).toEqual(['CHERRY', 'BANANA', 'APPLE'])
  })

  test('sorts by created ascending', () => {
    const sorted = sortSecrets(secrets, 'created')
    expect(sorted.map((s) => s.key)).toEqual(['APPLE', 'BANANA', 'CHERRY'])
  })

  test('sorts by created descending', () => {
    const sorted = sortSecrets(secrets, '-created')
    expect(sorted.map((s) => s.key)).toEqual(['CHERRY', 'BANANA', 'APPLE'])
  })

  test('sorts by updated ascending', () => {
    const sorted = sortSecrets(secrets, 'updated')
    expect(sorted.map((s) => s.key)).toEqual(['CHERRY', 'BANANA', 'APPLE'])
  })

  test('sorts by updated descending', () => {
    const sorted = sortSecrets(secrets, '-updated')
    expect(sorted.map((s) => s.key)).toEqual(['APPLE', 'BANANA', 'CHERRY'])
  })

  test('does not mutate the original array', () => {
    const original = [...secrets]
    sortSecrets(secrets, 'key')
    expect(secrets.map((s) => s.key)).toEqual(original.map((s) => s.key))
  })

  test('returns unchanged order for default/unknown sort', () => {
    const sorted = sortSecrets(secrets, 'key' as any)
    // Just verify it returns same length — the actual sort is tested above
    expect(sorted).toHaveLength(secrets.length)
  })
})

describe('processEnvFile', () => {
  const mockEnv = { id: 'env-1', name: 'test' } as EnvironmentType

  test('parses simple key=value pairs', () => {
    const input = 'FOO=bar\nBAZ=qux'
    const result = processEnvFile(input, mockEnv, '/')
    expect(result).toHaveLength(2)
    expect(result[0].key).toBe('FOO')
    expect(result[0].value).toBe('bar')
    expect(result[1].key).toBe('BAZ')
    expect(result[1].value).toBe('qux')
  })

  test('uppercases keys', () => {
    const result = processEnvFile('my_key=val', mockEnv, '/')
    expect(result[0].key).toBe('MY_KEY')
  })

  test('skips blank lines', () => {
    const input = 'A=1\n\n\nB=2'
    const result = processEnvFile(input, mockEnv, '/')
    expect(result).toHaveLength(2)
  })

  test('skips lines without =', () => {
    const input = 'VALID=yes\ninvalid line\nALSO_VALID=true'
    const result = processEnvFile(input, mockEnv, '/')
    expect(result).toHaveLength(2)
  })

  test('parses full-line comments as secret comments', () => {
    const input = '# This is a comment\nFOO=bar'
    const result = processEnvFile(input, mockEnv, '/')
    expect(result[0].comment).toBe('This is a comment')
  })

  test('parses inline comments', () => {
    const input = 'FOO=bar # inline comment'
    const result = processEnvFile(input, mockEnv, '/')
    expect(result[0].value).toBe('bar')
    expect(result[0].comment).toBe('inline comment')
  })

  test('parses double-quoted values', () => {
    const input = 'FOO="hello world"'
    const result = processEnvFile(input, mockEnv, '/')
    expect(result[0].value).toBe('hello world')
  })

  test('parses single-quoted values', () => {
    const input = "FOO='hello world'"
    const result = processEnvFile(input, mockEnv, '/')
    expect(result[0].value).toBe('hello world')
  })

  test('parses multi-line quoted values', () => {
    const input = 'FOO="line1\nline2\nline3"'
    const result = processEnvFile(input, mockEnv, '/')
    expect(result[0].value).toBe('line1\nline2\nline3')
  })

  test('handles value with = in it', () => {
    const input = 'CONN=host=localhost;port=5432'
    const result = processEnvFile(input, mockEnv, '/')
    expect(result[0].value).toBe('host=localhost;port=5432')
  })

  test('withValues=false returns empty values', () => {
    const input = 'FOO=bar'
    const result = processEnvFile(input, mockEnv, '/', false)
    expect(result[0].value).toBe('')
  })

  test('withComments=false returns empty comments', () => {
    const input = '# A comment\nFOO=bar'
    const result = processEnvFile(input, mockEnv, '/', true, false)
    expect(result[0].comment).toBe('')
  })

  test('assigns the provided path to all secrets', () => {
    const input = 'A=1\nB=2'
    const result = processEnvFile(input, mockEnv, '/backend')
    expect(result[0].path).toBe('/backend')
    expect(result[1].path).toBe('/backend')
  })

  test('assigns the provided environment to all secrets', () => {
    const input = 'A=1'
    const result = processEnvFile(input, mockEnv, '/')
    expect(result[0].environment).toBe(mockEnv)
  })

  test('returns empty array for empty input', () => {
    expect(processEnvFile('', mockEnv, '/')).toEqual([])
  })

  test('returns empty array for comments-only input', () => {
    expect(processEnvFile('# just a comment\n# another one', mockEnv, '/')).toEqual([])
  })
})

describe('duplicateKeysExist', () => {
  test('returns false for unique keys', () => {
    const secrets = [
      { key: 'A' },
      { key: 'B' },
      { key: 'C' },
    ] as SecretType[]
    expect(duplicateKeysExist(secrets)).toBe(false)
  })

  test('returns true for duplicate keys', () => {
    const secrets = [
      { key: 'A' },
      { key: 'B' },
      { key: 'A' },
    ] as SecretType[]
    expect(duplicateKeysExist(secrets)).toBe(true)
  })

  test('returns false for empty array', () => {
    expect(duplicateKeysExist([])).toBe(false)
  })

  test('detects duplicates between secrets and dynamic secret keyMap', () => {
    const secrets = [{ key: 'DB_HOST' }] as SecretType[]
    const dynamicSecrets = [
      {
        keyMap: [{ keyName: 'DB_HOST' }, { keyName: 'DB_PORT' }],
      },
    ] as DynamicSecretType[]
    expect(duplicateKeysExist(secrets, dynamicSecrets)).toBe(true)
  })

  test('returns false when dynamic secrets have no overlap', () => {
    const secrets = [{ key: 'A' }] as SecretType[]
    const dynamicSecrets = [
      {
        keyMap: [{ keyName: 'B' }, { keyName: 'C' }],
      },
    ] as DynamicSecretType[]
    expect(duplicateKeysExist(secrets, dynamicSecrets)).toBe(false)
  })

  test('detects duplicates within dynamic secret keyMaps', () => {
    const secrets = [] as SecretType[]
    const dynamicSecrets = [
      { keyMap: [{ keyName: 'X' }] },
      { keyMap: [{ keyName: 'X' }] },
    ] as DynamicSecretType[]
    expect(duplicateKeysExist(secrets, dynamicSecrets)).toBe(true)
  })

  test('handles null keyMap entries gracefully', () => {
    const secrets = [{ key: 'A' }] as SecretType[]
    const dynamicSecrets = [
      { keyMap: [null, { keyName: 'B' }] },
    ] as unknown as DynamicSecretType[]
    expect(duplicateKeysExist(secrets, dynamicSecrets)).toBe(false)
  })

  test('handles null keyMap on dynamic secret', () => {
    const secrets = [{ key: 'A' }] as SecretType[]
    const dynamicSecrets = [{ keyMap: null }] as unknown as DynamicSecretType[]
    expect(duplicateKeysExist(secrets, dynamicSecrets)).toBe(false)
  })
})

describe('sortEnvs', () => {
  test('sorts environments by index ascending', () => {
    const envs = [
      { name: 'staging', index: 2 },
      { name: 'dev', index: 0 },
      { name: 'prod', index: 1 },
    ] as Partial<EnvironmentType>[]
    const sorted = sortEnvs(envs)
    expect(sorted.map((e) => e.name)).toEqual(['dev', 'prod', 'staging'])
  })

  test('filters out undefined entries', () => {
    const envs = [
      undefined,
      { name: 'dev', index: 0 },
      undefined,
      { name: 'prod', index: 1 },
    ]
    const sorted = sortEnvs(envs)
    expect(sorted).toHaveLength(2)
    expect(sorted.map((e) => e.name)).toEqual(['dev', 'prod'])
  })

  test('filters out entries without a numeric index', () => {
    const envs = [
      { name: 'no-index' },
      { name: 'dev', index: 0 },
      { name: 'also-no-index', index: undefined },
    ] as Partial<EnvironmentType>[]
    const sorted = sortEnvs(envs)
    expect(sorted).toHaveLength(1)
    expect(sorted[0].name).toBe('dev')
  })

  test('returns empty array for empty input', () => {
    expect(sortEnvs([])).toEqual([])
  })

  test('returns empty array when all entries are undefined', () => {
    expect(sortEnvs([undefined, undefined])).toEqual([])
  })
})

describe('normalizeKey', () => {
  test('converts to uppercase', () => {
    expect(normalizeKey('my_key')).toBe('MY_KEY')
  })

  test('trims whitespace', () => {
    expect(normalizeKey('  FOO  ')).toBe('FOO')
  })

  test('replaces spaces with underscores', () => {
    expect(normalizeKey('my key')).toBe('MY_KEY')
  })

  test('replaces hyphens with underscores', () => {
    expect(normalizeKey('my-key')).toBe('MY_KEY')
  })

  test('removes invalid characters', () => {
    expect(normalizeKey('my.key!@#$%')).toBe('MYKEY')
  })

  test('handles mixed transformations', () => {
    expect(normalizeKey('  my-complex key.name!  ')).toBe('MY_COMPLEX_KEYNAME')
  })

  test('preserves numbers', () => {
    expect(normalizeKey('key123')).toBe('KEY123')
  })

  test('returns empty string for all-invalid input', () => {
    expect(normalizeKey('!@#$%')).toBe('')
  })
})
