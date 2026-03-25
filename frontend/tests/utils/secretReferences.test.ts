import {
  parseAllReferences,
  getActiveReferenceToken,
  computeSuggestions,
  buildInsertionText,
  getSuggestionUrl,
  segmentSecretValue,
  validateSecretReferences,
  secretIdKey,
  ReferenceContext,
  ActiveReferenceToken,
} from '@/utils/secretReferences'

// --- Helper: build a minimal ReferenceContext ---

function makeContext(overrides: Partial<ReferenceContext> = {}): ReferenceContext {
  return {
    teamSlug: 'my-team',
    appId: 'app-1',
    envId: 'env-dev-id',
    envIds: { development: 'env-dev-id', staging: 'env-stg-id', production: 'env-prod-id' },
    secretIdLookup: {},
    secretKeys: ['DB_HOST', 'DB_PORT', 'API_KEY', 'SECRET_TOKEN'],
    envSecretKeys: {
      development: ['DB_HOST', 'DB_PORT', 'API_KEY', 'SECRET_TOKEN'],
      staging: ['DB_HOST', 'DB_PORT', 'STAGING_ONLY'],
      production: ['DB_HOST', 'DB_PORT', 'PROD_KEY'],
    },
    envRootKeys: {
      development: ['DB_HOST', 'DB_PORT', 'API_KEY', 'SECRET_TOKEN'],
      staging: ['DB_HOST', 'DB_PORT', 'STAGING_ONLY'],
      production: ['DB_HOST', 'DB_PORT', 'PROD_KEY'],
    },
    envNames: ['Development', 'Staging', 'Production'],
    folderPaths: ['backend', 'backend/config'],
    folderSecretKeys: {
      backend: ['REDIS_URL', 'WORKER_COUNT'],
      'backend/config': ['LOG_LEVEL'],
    },
    envFolderKeys: {
      development: {
        backend: ['REDIS_URL', 'WORKER_COUNT'],
        'backend/config': ['LOG_LEVEL'],
      },
    },
    orgApps: [
      {
        id: 'app-2',
        name: 'OtherApp',
        envNames: ['Development', 'Production'],
        envIds: { development: 'other-env-dev', production: 'other-env-prod' },
        envSecretKeys: { development: ['OTHER_KEY'], production: ['OTHER_PROD'] },
        envRootKeys: { development: ['OTHER_KEY'], production: ['OTHER_PROD'] },
        folderKeys: { services: ['SVC_KEY'] },
        envFolderKeys: { development: { services: ['SVC_KEY'] } },
        secretIdLookup: { 'development|/|OTHER_KEY': 'other-secret-id' },
      },
    ],
    deletedKeys: [],
    ...overrides,
  }
}

// =====================================================
// parseAllReferences
// =====================================================

describe('parseAllReferences', () => {
  test('parses local references', () => {
    const refs = parseAllReferences('prefix ${DB_HOST} suffix')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('local')
    expect(refs[0].fullMatch).toBe('${DB_HOST}')
    expect(refs[0].pathAndKey).toBe('DB_HOST')
  })

  test('parses local reference with path', () => {
    const refs = parseAllReferences('${backend/API_KEY}')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('local')
    expect(refs[0].pathAndKey).toBe('backend/API_KEY')
  })

  test('parses cross-env references', () => {
    const refs = parseAllReferences('${staging.DB_HOST}')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('cross-env')
    expect(refs[0].env).toBe('staging')
    expect(refs[0].pathAndKey).toBe('DB_HOST')
  })

  test('parses cross-env reference with path', () => {
    const refs = parseAllReferences('${staging.backend/API_KEY}')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('cross-env')
    expect(refs[0].env).toBe('staging')
    expect(refs[0].pathAndKey).toBe('backend/API_KEY')
  })

  test('parses cross-app references', () => {
    const refs = parseAllReferences('${OtherApp::production.SECRET}')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('cross-app')
    expect(refs[0].app).toBe('OtherApp')
    expect(refs[0].env).toBe('production')
    expect(refs[0].pathAndKey).toBe('SECRET')
  })

  test('parses cross-app reference with path', () => {
    const refs = parseAllReferences('${OtherApp::production.backend/SECRET}')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('cross-app')
    expect(refs[0].app).toBe('OtherApp')
    expect(refs[0].env).toBe('production')
    expect(refs[0].pathAndKey).toBe('backend/SECRET')
  })

  test('parses multiple references in one value', () => {
    const refs = parseAllReferences('host=${DB_HOST}:${DB_PORT}')
    expect(refs).toHaveLength(2)
    expect(refs[0].pathAndKey).toBe('DB_HOST')
    expect(refs[1].pathAndKey).toBe('DB_PORT')
  })

  test('parses multiple local references in one value', () => {
    const refs = parseAllReferences('${A} text ${B} more ${C}')
    expect(refs).toHaveLength(3)
    expect(refs.every((r) => r.type === 'local')).toBe(true)
    expect(refs.map((r) => r.pathAndKey)).toEqual(['A', 'B', 'C'])
  })

  test('parses multiple cross-env references in one value', () => {
    const refs = parseAllReferences('${dev.KEY1} ${staging.KEY2}')
    expect(refs).toHaveLength(2)
    expect(refs.every((r) => r.type === 'cross-env')).toBe(true)
    expect(refs[0].env).toBe('dev')
    expect(refs[1].env).toBe('staging')
  })

  test('excludes Railway double-brace syntax ${{...}}', () => {
    const refs = parseAllReferences('${{RAILWAY_VAR}}')
    expect(refs).toHaveLength(0)
  })

  test('handles Railway syntax mixed with real references', () => {
    const refs = parseAllReferences('${{RAILWAY}} ${DB_HOST}')
    expect(refs).toHaveLength(1)
    expect(refs[0].type).toBe('local')
    expect(refs[0].pathAndKey).toBe('DB_HOST')
  })

  test('returns empty array for no references', () => {
    expect(parseAllReferences('plain value')).toEqual([])
    expect(parseAllReferences('')).toEqual([])
  })

  test('returns references sorted by position', () => {
    const refs = parseAllReferences('${B} ${A}')
    expect(refs[0].startIndex).toBeLessThan(refs[1].startIndex)
  })

  test('tracks correct startIndex and endIndex', () => {
    const value = 'pre ${KEY} post'
    const refs = parseAllReferences(value)
    expect(refs[0].startIndex).toBe(4)
    expect(refs[0].endIndex).toBe(10)
    expect(value.slice(refs[0].startIndex, refs[0].endIndex)).toBe('${KEY}')
  })
})

// =====================================================
// getActiveReferenceToken
// =====================================================

describe('getActiveReferenceToken', () => {
  test('returns null when no ${ present', () => {
    expect(getActiveReferenceToken('plain text', 5)).toBeNull()
  })

  test('returns null when cursor is before ${', () => {
    expect(getActiveReferenceToken('hello ${KEY}', 3)).toBeNull()
  })

  test('returns null when reference is already closed', () => {
    expect(getActiveReferenceToken('${KEY} more', 8)).toBeNull()
  })

  test('detects initial stage after ${', () => {
    const token = getActiveReferenceToken('${', 2)
    expect(token).not.toBeNull()
    expect(token!.stage).toBe('initial')
    expect(token!.filterText).toBe('')
  })

  test('detects initial stage with partial key', () => {
    const token = getActiveReferenceToken('${DB', 4)
    expect(token!.stage).toBe('initial')
    expect(token!.filterText).toBe('DB')
  })

  test('detects cross-env-key stage', () => {
    const token = getActiveReferenceToken('${staging.DB', 12)
    expect(token!.stage).toBe('cross-env-key')
    expect(token!.env).toBe('staging')
    expect(token!.filterText).toBe('DB')
  })

  test('detects cross-env-key stage with empty filter', () => {
    const token = getActiveReferenceToken('${staging.', 10)
    expect(token!.stage).toBe('cross-env-key')
    expect(token!.env).toBe('staging')
    expect(token!.filterText).toBe('')
  })

  test('detects cross-app-env stage', () => {
    const token = getActiveReferenceToken('${MyApp::st', 11)
    expect(token!.stage).toBe('cross-app-env')
    expect(token!.app).toBe('MyApp')
    expect(token!.filterText).toBe('st')
  })

  test('detects cross-app-key stage', () => {
    const token = getActiveReferenceToken('${MyApp::prod.SEC', 18)
    expect(token!.stage).toBe('cross-app-key')
    expect(token!.app).toBe('MyApp')
    expect(token!.env).toBe('prod')
    expect(token!.filterText).toBe('SEC')
  })

  test('detects folder-key stage', () => {
    const token = getActiveReferenceToken('${backend/', 10)
    expect(token!.stage).toBe('folder-key')
    expect(token!.folderPath).toBe('backend')
    expect(token!.filterText).toBe('')
  })

  test('detects folder-key stage with partial key', () => {
    const token = getActiveReferenceToken('${backend/RED', 13)
    expect(token!.stage).toBe('folder-key')
    expect(token!.folderPath).toBe('backend')
    expect(token!.filterText).toBe('RED')
  })

  test('excludes ${{ (Railway syntax)', () => {
    expect(getActiveReferenceToken('${{RAIL', 7)).toBeNull()
  })

  test('works with cursor in the middle of a value', () => {
    const value = 'host=${DB_HOST} port=${DB'
    const token = getActiveReferenceToken(value, value.length)
    expect(token!.stage).toBe('initial')
    expect(token!.filterText).toBe('DB')
  })

  test('returns correct startIndex', () => {
    const value = 'prefix ${KEY'
    const token = getActiveReferenceToken(value, value.length)
    expect(token!.startIndex).toBe(7) // position of $
  })
})

// =====================================================
// computeSuggestions
// =====================================================

describe('computeSuggestions', () => {
  const ctx = makeContext()

  test('initial stage returns keys, envs, apps, and folders', () => {
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: '',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
    }
    const suggestions = computeSuggestions(token, ctx)
    const types = new Set(suggestions.map((s) => s.type))
    expect(types).toContain('key')
    expect(types).toContain('env')
    expect(types).toContain('app')
    expect(types).toContain('folder')
  })

  test('initial stage filters by text', () => {
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: 'DB',
      startIndex: 0,
      insideClosedRef: false,
      filterText: 'DB',
    }
    const suggestions = computeSuggestions(token, ctx)
    const keyLabels = suggestions.filter((s) => s.type === 'key').map((s) => s.label)
    expect(keyLabels).toContain('DB_HOST')
    expect(keyLabels).toContain('DB_PORT')
    expect(keyLabels).not.toContain('API_KEY')
  })

  test('excludes current secret key from suggestions', () => {
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: '',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
    }
    const suggestions = computeSuggestions(token, ctx, 'DB_HOST')
    const keyLabels = suggestions.filter((s) => s.type === 'key').map((s) => s.label)
    expect(keyLabels).not.toContain('DB_HOST')
    expect(keyLabels).toContain('DB_PORT')
  })

  test('excludes deleted keys from suggestions', () => {
    const ctxWithDeleted = makeContext({ deletedKeys: ['API_KEY'] })
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: '',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
    }
    const suggestions = computeSuggestions(token, ctxWithDeleted)
    const keyLabels = suggestions.filter((s) => s.type === 'key').map((s) => s.label)
    expect(keyLabels).not.toContain('API_KEY')
  })

  test('env suggestions have dot suffix in insertText', () => {
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: '',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
    }
    const suggestions = computeSuggestions(token, ctx)
    const envSuggestion = suggestions.find((s) => s.type === 'env')
    expect(envSuggestion).toBeDefined()
    expect(envSuggestion!.insertText).toMatch(/\.$/)
    expect(envSuggestion!.closesReference).toBe(false)
  })

  test('app suggestions have :: suffix in insertText', () => {
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: '',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
    }
    const suggestions = computeSuggestions(token, ctx)
    const appSuggestion = suggestions.find((s) => s.type === 'app')
    expect(appSuggestion).toBeDefined()
    expect(appSuggestion!.insertText).toMatch(/::$/)
    expect(appSuggestion!.closesReference).toBe(false)
  })

  test('key suggestions close reference', () => {
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: 'DB_HOST',
      startIndex: 0,
      insideClosedRef: false,
      filterText: 'DB_HOST',
    }
    const suggestions = computeSuggestions(token, ctx)
    const keySuggestion = suggestions.find((s) => s.type === 'key' && s.label === 'DB_HOST')
    expect(keySuggestion).toBeDefined()
    expect(keySuggestion!.closesReference).toBe(true)
  })

  test('cross-env-key stage shows keys from target env', () => {
    const token: ActiveReferenceToken = {
      stage: 'cross-env-key',
      raw: 'staging.',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
      env: 'staging',
    }
    const suggestions = computeSuggestions(token, ctx)
    const keyLabels = suggestions.filter((s) => s.type === 'key').map((s) => s.label)
    expect(keyLabels).toContain('STAGING_ONLY')
    expect(keyLabels).toContain('DB_HOST')
    expect(keyLabels).not.toContain('API_KEY') // not in staging root keys
  })

  test('cross-env-key stage shows folder suggestions scoped to target env', () => {
    const token: ActiveReferenceToken = {
      stage: 'cross-env-key',
      raw: 'development.',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
      env: 'development',
    }
    const suggestions = computeSuggestions(token, ctx)
    const folderLabels = suggestions.filter((s) => s.type === 'folder').map((s) => s.label)
    expect(folderLabels).toContain('backend/')

    // Env without folders should show no folder suggestions
    const tokenStaging: ActiveReferenceToken = {
      stage: 'cross-env-key',
      raw: 'staging.',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
      env: 'staging',
    }
    const stagingSuggestions = computeSuggestions(tokenStaging, ctx)
    const stagingFolders = stagingSuggestions.filter((s) => s.type === 'folder')
    expect(stagingFolders).toHaveLength(0)
  })

  test('cross-app-env stage shows envs from target app', () => {
    const token: ActiveReferenceToken = {
      stage: 'cross-app-env',
      raw: 'OtherApp::',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
      app: 'OtherApp',
    }
    const suggestions = computeSuggestions(token, ctx)
    const envLabels = suggestions.map((s) => s.label)
    expect(envLabels).toContain('Development')
    expect(envLabels).toContain('Production')
  })

  test('cross-app-env returns empty for unknown app', () => {
    const token: ActiveReferenceToken = {
      stage: 'cross-app-env',
      raw: 'UnknownApp::',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
      app: 'UnknownApp',
    }
    const suggestions = computeSuggestions(token, ctx)
    expect(suggestions).toHaveLength(0)
  })

  test('cross-app-key stage shows keys from target app/env', () => {
    const token: ActiveReferenceToken = {
      stage: 'cross-app-key',
      raw: 'OtherApp::development.',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
      app: 'OtherApp',
      env: 'development',
    }
    const suggestions = computeSuggestions(token, ctx)
    const keyLabels = suggestions.filter((s) => s.type === 'key').map((s) => s.label)
    expect(keyLabels).toContain('OTHER_KEY')
  })

  test('folder-key stage shows keys at folder path', () => {
    const token: ActiveReferenceToken = {
      stage: 'folder-key',
      raw: 'backend/',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
      folderPath: 'backend',
    }
    const suggestions = computeSuggestions(token, ctx)
    const keyLabels = suggestions.filter((s) => s.type === 'key').map((s) => s.label)
    expect(keyLabels).toContain('REDIS_URL')
    expect(keyLabels).toContain('WORKER_COUNT')
  })

  test('folder-key stage shows subfolder suggestions', () => {
    const token: ActiveReferenceToken = {
      stage: 'folder-key',
      raw: 'backend/',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
      folderPath: 'backend',
    }
    const suggestions = computeSuggestions(token, ctx)
    const folderLabels = suggestions.filter((s) => s.type === 'folder').map((s) => s.label)
    expect(folderLabels).toContain('config/')
  })

  test('case-insensitive filtering', () => {
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: 'db',
      startIndex: 0,
      insideClosedRef: false,
      filterText: 'db',
    }
    const suggestions = computeSuggestions(token, ctx)
    const keyLabels = suggestions.filter((s) => s.type === 'key').map((s) => s.label)
    expect(keyLabels).toContain('DB_HOST')
    expect(keyLabels).toContain('DB_PORT')
  })
})

// =====================================================
// buildInsertionText
// =====================================================

describe('buildInsertionText', () => {
  test('inserts key with closing brace', () => {
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: 'DB',
      startIndex: 0,
      insideClosedRef: false,
      filterText: 'DB',
    }
    const suggestion = {
      label: 'DB_HOST',
      insertText: 'DB_HOST',
      type: 'key' as const,
      closesReference: true,
    }
    const result = buildInsertionText(suggestion, token, '${DB')
    expect(result.newValue).toBe('${DB_HOST}')
    expect(result.newCursorPos).toBe(10) // after }
  })

  test('inserts env prefix without closing brace', () => {
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: 'st',
      startIndex: 0,
      insideClosedRef: false,
      filterText: 'st',
    }
    const suggestion = {
      label: 'Staging',
      insertText: 'Staging.',
      type: 'env' as const,
      closesReference: false,
    }
    const result = buildInsertionText(suggestion, token, '${st')
    expect(result.newValue).toBe('${Staging.')
    expect(result.newCursorPos).toBe(10) // after .
  })

  test('preserves text before and after the reference', () => {
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: 'K',
      startIndex: 7,
      insideClosedRef: false,
      filterText: 'K',
    }
    const suggestion = {
      label: 'KEY',
      insertText: 'KEY',
      type: 'key' as const,
      closesReference: true,
    }
    const result = buildInsertionText(suggestion, token, 'prefix ${K} suffix')
    // Cursor is inside a closed reference ${K} — the new code detects the closing }
    // and consumes it, so selecting KEY replaces the entire reference content correctly.
    expect(result.newValue).toBe('prefix ${KEY} suffix')
  })

  test('preserves text before and after an unclosed reference', () => {
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: 'K',
      startIndex: 7,
      insideClosedRef: false,
      filterText: 'K',
    }
    const suggestion = {
      label: 'KEY',
      insertText: 'KEY',
      type: 'key' as const,
      closesReference: true,
    }
    const result = buildInsertionText(suggestion, token, 'prefix ${K suffix')
    expect(result.newValue).toBe('prefix ${KEY} suffix')
  })

  test('inserts cross-env key with full insertText', () => {
    const token: ActiveReferenceToken = {
      stage: 'cross-env-key',
      raw: 'staging.DB',
      startIndex: 0,
      insideClosedRef: false,
      filterText: 'DB',
      env: 'staging',
    }
    const suggestion = {
      label: 'DB_HOST',
      insertText: 'staging.DB_HOST',
      type: 'key' as const,
      closesReference: true,
    }
    const result = buildInsertionText(suggestion, token, '${staging.DB')
    expect(result.newValue).toBe('${staging.DB_HOST}')
  })

  test('inserts app prefix', () => {
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: 'Oth',
      startIndex: 0,
      insideClosedRef: false,
      filterText: 'Oth',
    }
    const suggestion = {
      label: 'OtherApp',
      insertText: 'OtherApp::',
      type: 'app' as const,
      closesReference: false,
    }
    const result = buildInsertionText(suggestion, token, '${Oth')
    expect(result.newValue).toBe('${OtherApp::')
    expect(result.newCursorPos).toBe(12)
  })
})

// =====================================================
// getSuggestionUrl
// =====================================================

describe('getSuggestionUrl', () => {
  const ctx = makeContext()

  test('returns app URL for app suggestions', () => {
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: '',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
    }
    const suggestion = {
      label: 'OtherApp',
      insertText: 'OtherApp::',
      type: 'app' as const,
      closesReference: false,
    }
    const url = getSuggestionUrl(suggestion, token, ctx)
    expect(url).toBe('/my-team/apps/app-2')
  })

  test('returns null for unknown app', () => {
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: '',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
    }
    const suggestion = {
      label: 'NonExistent',
      insertText: 'NonExistent::',
      type: 'app' as const,
      closesReference: false,
    }
    expect(getSuggestionUrl(suggestion, token, ctx)).toBeNull()
  })

  test('returns env URL for env suggestions (current app)', () => {
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: '',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
    }
    const suggestion = {
      label: 'Staging',
      insertText: 'Staging.',
      type: 'env' as const,
      closesReference: false,
    }
    const url = getSuggestionUrl(suggestion, token, ctx)
    expect(url).toBe('/my-team/apps/app-1/environments/env-stg-id')
  })

  test('returns env URL for cross-app env suggestions', () => {
    const token: ActiveReferenceToken = {
      stage: 'cross-app-env',
      raw: 'OtherApp::',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
      app: 'OtherApp',
    }
    const suggestion = {
      label: 'Development',
      insertText: 'OtherApp::Development.',
      type: 'env' as const,
      closesReference: false,
    }
    const url = getSuggestionUrl(suggestion, token, ctx)
    expect(url).toBe('/my-team/apps/app-2/environments/other-env-dev')
  })

  test('returns key URL with secret ID when available', () => {
    const ctxWithIds = makeContext({
      secretIdLookup: { 'development|/|DB_HOST': 'secret-123' },
    })
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: 'DB_HOST',
      startIndex: 0,
      insideClosedRef: false,
      filterText: 'DB_HOST',
    }
    const suggestion = {
      label: 'DB_HOST',
      insertText: 'DB_HOST',
      type: 'key' as const,
      closesReference: true,
    }
    const url = getSuggestionUrl(suggestion, token, ctxWithIds)
    expect(url).toContain('?secret=secret-123')
  })

  test('returns null for local key when no envId', () => {
    const ctxNoEnv = makeContext({ envId: undefined })
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: 'DB_HOST',
      startIndex: 0,
      insideClosedRef: false,
      filterText: 'DB_HOST',
    }
    const suggestion = {
      label: 'DB_HOST',
      insertText: 'DB_HOST',
      type: 'key' as const,
      closesReference: true,
    }
    expect(getSuggestionUrl(suggestion, token, ctxNoEnv)).toBeNull()
  })

  test('returns folder URL', () => {
    const token: ActiveReferenceToken = {
      stage: 'initial',
      raw: '',
      startIndex: 0,
      insideClosedRef: false,
      filterText: '',
    }
    const suggestion = {
      label: 'backend/',
      insertText: 'backend/',
      type: 'folder' as const,
      closesReference: false,
    }
    const url = getSuggestionUrl(suggestion, token, ctx)
    expect(url).toBe('/my-team/apps/app-1/environments/env-dev-id/backend')
  })
})

// =====================================================
// segmentSecretValue
// =====================================================

describe('segmentSecretValue', () => {
  test('returns single plain segment for non-reference text', () => {
    const segments = segmentSecretValue('plain text')
    expect(segments).toEqual([{ text: 'plain text', type: 'plain' }])
  })

  test('returns single plain segment for empty string', () => {
    const segments = segmentSecretValue('')
    expect(segments).toEqual([{ text: '', type: 'plain' }])
  })

  test('segments a local reference', () => {
    const segments = segmentSecretValue('${DB_HOST}')
    expect(segments).toEqual([
      { text: '${', type: 'delimiter' },
      { text: 'DB_HOST', type: 'key' },
      { text: '}', type: 'delimiter' },
    ])
  })

  test('segments a local reference with path', () => {
    const segments = segmentSecretValue('${backend/KEY}')
    expect(segments).toEqual([
      { text: '${', type: 'delimiter' },
      { text: 'backend/', type: 'folder' },
      { text: 'KEY', type: 'key' },
      { text: '}', type: 'delimiter' },
    ])
  })

  test('segments a cross-env reference', () => {
    const segments = segmentSecretValue('${staging.DB_HOST}')
    expect(segments).toEqual([
      { text: '${', type: 'delimiter' },
      { text: 'staging', type: 'env' },
      { text: '.', type: 'delimiter' },
      { text: 'DB_HOST', type: 'key' },
      { text: '}', type: 'delimiter' },
    ])
  })

  test('segments a cross-app reference', () => {
    const segments = segmentSecretValue('${MyApp::prod.SECRET}')
    expect(segments).toEqual([
      { text: '${', type: 'delimiter' },
      { text: 'MyApp', type: 'app' },
      { text: '::', type: 'delimiter' },
      { text: 'prod', type: 'env' },
      { text: '.', type: 'delimiter' },
      { text: 'SECRET', type: 'key' },
      { text: '}', type: 'delimiter' },
    ])
  })

  test('segments a cross-app reference with path', () => {
    const segments = segmentSecretValue('${MyApp::prod.backend/SECRET}')
    expect(segments).toEqual([
      { text: '${', type: 'delimiter' },
      { text: 'MyApp', type: 'app' },
      { text: '::', type: 'delimiter' },
      { text: 'prod', type: 'env' },
      { text: '.', type: 'delimiter' },
      { text: 'backend/', type: 'folder' },
      { text: 'SECRET', type: 'key' },
      { text: '}', type: 'delimiter' },
    ])
  })

  test('includes plain text between references', () => {
    const segments = segmentSecretValue('host=${HOST}:${PORT}')
    expect(segments[0]).toEqual({ text: 'host=', type: 'plain' })
    // then ${HOST} segments
    expect(segments[4]).toEqual({ text: ':', type: 'plain' })
    // then ${PORT} segments
  })

  test('includes trailing plain text', () => {
    const segments = segmentSecretValue('${KEY}/path')
    const last = segments[segments.length - 1]
    expect(last).toEqual({ text: '/path', type: 'plain' })
  })

  test('does not segment Railway double-brace syntax', () => {
    const segments = segmentSecretValue('${{RAILWAY}}')
    expect(segments).toEqual([{ text: '${{RAILWAY}}', type: 'plain' }])
  })
})

// =====================================================
// secretIdKey
// =====================================================

describe('secretIdKey', () => {
  test('lowercases env name', () => {
    expect(secretIdKey('Production', '/', 'KEY')).toBe('production|/|KEY')
  })

  test('preserves path and key as-is', () => {
    expect(secretIdKey('dev', '/backend', 'API_KEY')).toBe('dev|/backend|API_KEY')
  })
})

// =====================================================
// validateSecretReferences
// =====================================================

describe('validateSecretReferences', () => {
  const ctx = makeContext()

  const makeSecrets = (
    entries: { key: string; envName: string; value: string }[]
  ) =>
    entries.map((e) => ({
      key: e.key,
      envs: [
        {
          env: { id: 'env-1', name: e.envName },
          secret: { value: e.value },
        },
      ],
    }))

  test('returns no errors for valid local references', () => {
    const secrets = makeSecrets([
      { key: 'CONN', envName: 'Development', value: '${DB_HOST}:${DB_PORT}' },
    ])
    const errors = validateSecretReferences(secrets, ctx)
    expect(errors).toHaveLength(0)
  })

  test('detects reference to non-existent local key', () => {
    const secrets = makeSecrets([
      { key: 'CONN', envName: 'Development', value: '${NONEXISTENT}' },
    ])
    const errors = validateSecretReferences(secrets, ctx)
    expect(errors).toHaveLength(1)
    expect(errors[0].secretKey).toBe('CONN')
    expect(errors[0].reference).toBe('${NONEXISTENT}')
    expect(errors[0].error).toContain('does not exist')
  })

  test('detects reference to deleted key', () => {
    const ctxWithDeleted = makeContext({ deletedKeys: ['DB_HOST'] })
    const secrets = makeSecrets([
      { key: 'CONN', envName: 'Development', value: '${DB_HOST}' },
    ])
    const errors = validateSecretReferences(secrets, ctxWithDeleted)
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toContain('staged for deletion')
  })

  test('validates cross-env references — valid', () => {
    const secrets = makeSecrets([
      { key: 'REF', envName: 'Development', value: '${staging.DB_HOST}' },
    ])
    const errors = validateSecretReferences(secrets, ctx)
    expect(errors).toHaveLength(0)
  })

  test('detects non-existent env in cross-env reference', () => {
    const secrets = makeSecrets([
      { key: 'REF', envName: 'Development', value: '${nonexistent.DB_HOST}' },
    ])
    const errors = validateSecretReferences(secrets, ctx)
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toContain('environment')
    expect(errors[0].error).toContain('does not exist')
  })

  test('detects non-existent key in cross-env reference', () => {
    const secrets = makeSecrets([
      { key: 'REF', envName: 'Development', value: '${staging.MISSING_KEY}' },
    ])
    const errors = validateSecretReferences(secrets, ctx)
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toContain('does not exist in "staging"')
  })

  test('validates cross-app references — valid', () => {
    const secrets = makeSecrets([
      { key: 'REF', envName: 'Development', value: '${OtherApp::development.OTHER_KEY}' },
    ])
    const errors = validateSecretReferences(secrets, ctx)
    expect(errors).toHaveLength(0)
  })

  test('detects non-existent app in cross-app reference', () => {
    const secrets = makeSecrets([
      { key: 'REF', envName: 'Development', value: '${FakeApp::dev.KEY}' },
    ])
    const errors = validateSecretReferences(secrets, ctx)
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toContain('app')
    expect(errors[0].error).toContain('does not exist')
  })

  test('detects non-existent env in cross-app reference', () => {
    const secrets = makeSecrets([
      { key: 'REF', envName: 'Development', value: '${OtherApp::fakeenv.KEY}' },
    ])
    const errors = validateSecretReferences(secrets, ctx)
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toContain('environment')
    expect(errors[0].error).toContain('does not exist in app')
  })

  test('detects non-existent key in cross-app reference', () => {
    const secrets = makeSecrets([
      { key: 'REF', envName: 'Development', value: '${OtherApp::development.MISSING}' },
    ])
    const errors = validateSecretReferences(secrets, ctx)
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toContain('does not exist in "OtherApp"')
  })

  test('skips secrets staged for delete', () => {
    const secrets = [
      {
        key: 'DELETED',
        envs: [
          {
            env: { id: 'env-1', name: 'Development' },
            secret: { value: '${NONEXISTENT}', stagedForDelete: true },
          },
        ],
      },
    ]
    const errors = validateSecretReferences(secrets, ctx)
    expect(errors).toHaveLength(0)
  })

  test('skips secrets with null value', () => {
    const secrets = [
      {
        key: 'EMPTY',
        envs: [{ env: { id: 'env-1', name: 'Development' }, secret: null }],
      },
    ]
    const errors = validateSecretReferences(secrets, ctx)
    expect(errors).toHaveLength(0)
  })

  test('does not flag Railway double-brace syntax', () => {
    const secrets = makeSecrets([
      { key: 'RAIL', envName: 'Development', value: '${{RAILWAY_VAR}}' },
    ])
    const errors = validateSecretReferences(secrets, ctx)
    expect(errors).toHaveLength(0)
  })

  test('reports multiple errors across secrets', () => {
    const secrets = makeSecrets([
      { key: 'A', envName: 'Development', value: '${MISSING_1}' },
      { key: 'B', envName: 'Staging', value: '${MISSING_2}' },
    ])
    const errors = validateSecretReferences(secrets, ctx)
    expect(errors).toHaveLength(2)
    expect(errors[0].secretKey).toBe('A')
    expect(errors[1].secretKey).toBe('B')
  })
})
