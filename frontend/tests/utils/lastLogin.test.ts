import {
  LAST_LOGIN_STORAGE_KEY,
  MAX_REMEMBERED_LOGINS,
  PENDING_LOGIN_STORAGE_KEY,
  PENDING_LOGIN_TTL_MS,
  REMEMBERED_LOGIN_TTL_MS,
  clearPendingLogin,
  findRememberedLogin,
  forgetLogin,
  getRememberedLogins,
  isSameLoginMethod,
  parseLoginMethod,
  parseRememberedLogins,
  rememberLogin,
  setPendingLogin,
  subscribeToRememberedLogins,
  syncLastLogin,
} from '@/utils/lastLogin'

const NOW = 1_800_000_000_000
const okta = {
  kind: 'org-sso' as const,
  id: 'cfg-1',
  provider: 'okta',
  providerName: 'Okta',
  organisationName: 'Acme',
}

const stored = (key = LAST_LOGIN_STORAGE_KEY) => {
  const raw = localStorage.getItem(key)
  return raw ? JSON.parse(raw) : null
}

describe('lastLogin', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('remembered logins', () => {
    test('most recent first, one entry per email (case-insensitive)', () => {
      rememberLogin('ada@acme.test', { kind: 'password' }, NOW - 3000)
      rememberLogin('ada@personal.test', { kind: 'instance-sso', slug: 'google' }, NOW - 2000)
      rememberLogin('  ADA@acme.test ', { kind: 'instance-sso', slug: 'github' }, NOW - 1000)

      expect(getRememberedLogins(NOW)).toEqual([
        {
          email: 'ada@acme.test',
          method: { kind: 'instance-sso', slug: 'github' },
          lastUsedAt: NOW - 1000,
        },
        {
          email: 'ada@personal.test',
          method: { kind: 'instance-sso', slug: 'google' },
          lastUsedAt: NOW - 2000,
        },
      ])
    })

    test(`keeps at most ${MAX_REMEMBERED_LOGINS} accounts`, () => {
      for (let i = 0; i < MAX_REMEMBERED_LOGINS + 2; i++) {
        rememberLogin(`user${i}@acme.test`, { kind: 'password' }, NOW - 1000 + i)
      }
      const emails = getRememberedLogins(NOW).map((l) => l.email)
      expect(emails).toHaveLength(MAX_REMEMBERED_LOGINS)
      expect(emails[0]).toBe(`user${MAX_REMEMBERED_LOGINS + 1}@acme.test`)
      expect(stored().logins).toHaveLength(MAX_REMEMBERED_LOGINS)
    })

    test('drops accounts unused for longer than the TTL', () => {
      rememberLogin('old@acme.test', { kind: 'password' }, NOW - REMEMBERED_LOGIN_TTL_MS - 1)
      rememberLogin('new@acme.test', { kind: 'password' }, NOW - 1)
      expect(getRememberedLogins(NOW).map((l) => l.email)).toEqual(['new@acme.test'])
    })

    test('ignores invalid input instead of storing it', () => {
      rememberLogin('not-an-email', { kind: 'password' }, NOW)
      rememberLogin('ada@acme.test', { kind: 'instance-sso', slug: '../evil' }, NOW)
      rememberLogin('ada@acme.test', { kind: 'magic-link' } as any, NOW)
      expect(localStorage.getItem(LAST_LOGIN_STORAGE_KEY)).toBeNull()
    })

    test('forgetting an account removes it, and the key once empty', () => {
      rememberLogin('ada@acme.test', { kind: 'password' }, NOW - 2000)
      rememberLogin('bob@acme.test', okta, NOW - 1000)

      forgetLogin('ADA@acme.test')
      expect(getRememberedLogins(NOW).map((l) => l.email)).toEqual(['bob@acme.test'])

      forgetLogin('bob@acme.test')
      expect(localStorage.getItem(LAST_LOGIN_STORAGE_KEY)).toBeNull()
    })

    test('finds an account by normalised email', () => {
      rememberLogin('ada@acme.test', { kind: 'password' }, NOW)
      const logins = getRememberedLogins(NOW)
      expect(findRememberedLogin(logins, ' Ada@Acme.test ')?.email).toBe('ada@acme.test')
      expect(findRememberedLogin(logins, 'bob@acme.test')).toBeUndefined()
      expect(findRememberedLogin(logins, '')).toBeUndefined()
    })
  })

  describe('defensive parsing', () => {
    test.each([
      ['missing', null],
      ['not JSON', '{nope'],
      ['wrong shape', JSON.stringify(['ada@acme.test'])],
      ['unknown version', JSON.stringify({ v: 99, logins: [] })],
      ['logins not an array', JSON.stringify({ v: 1, logins: {} })],
    ])('%s data reads as empty', (_, raw) => {
      expect(parseRememberedLogins(raw, NOW)).toEqual([])
    })

    test('keeps valid entries and skips malformed ones', () => {
      const raw = JSON.stringify({
        v: 1,
        logins: [
          null,
          'ada@acme.test',
          { email: 'bad', method: { kind: 'password' }, lastUsedAt: NOW },
          { email: 'ada@acme.test', method: { kind: 'telepathy' }, lastUsedAt: NOW },
          { email: 'ada@acme.test', method: { kind: 'password' }, lastUsedAt: 'yesterday' },
          { email: 'ada@acme.test', method: { kind: 'org-sso', id: 'a b' }, lastUsedAt: NOW },
          { email: 'bob@acme.test', method: { kind: 'password' }, lastUsedAt: NOW - 5 },
          // Duplicate email: the most recent wins
          { email: 'bob@acme.test', method: okta, lastUsedAt: NOW - 1 },
        ],
      })
      expect(parseRememberedLogins(raw, NOW)).toEqual([
        { email: 'bob@acme.test', method: okta, lastUsedAt: NOW - 1 },
      ])
    })

    test('clamps timestamps from the future', () => {
      const raw = JSON.stringify({
        v: 1,
        logins: [{ email: 'ada@acme.test', method: { kind: 'password' }, lastUsedAt: NOW * 2 }],
      })
      expect(parseRememberedLogins(raw, NOW)[0].lastUsedAt).toBe(NOW)
    })

    test('strips unsafe or oversized display details', () => {
      expect(
        parseLoginMethod({
          kind: 'org-sso',
          id: 'cfg-1',
          provider: 'okta"><script>',
          providerName: 'x'.repeat(500),
          organisationName: '   ',
        })
      ).toEqual({ kind: 'org-sso', id: 'cfg-1' })
    })

    test('survives storage being unavailable', () => {
      jest.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
        throw new Error('SecurityError')
      })
      expect(getRememberedLogins(NOW)).toEqual([])
      expect(() => rememberLogin('ada@acme.test', { kind: 'password' }, NOW)).not.toThrow()
      expect(() => forgetLogin('ada@acme.test')).not.toThrow()
      expect(() => setPendingLogin({ kind: 'instance-sso', slug: 'google' })).not.toThrow()
      expect(() =>
        syncLastLogin({ email: 'ada@acme.test', authMethod: 'password' }, NOW)
      ).not.toThrow()
    })

    test('survives writes failing (quota exceeded)', () => {
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
      expect(() => rememberLogin('ada@acme.test', { kind: 'password' }, NOW)).not.toThrow()
      expect(getRememberedLogins(NOW)).toEqual([])
    })
  })

  describe('isSameLoginMethod', () => {
    test('compares kind and provider identity, not display details', () => {
      expect(isSameLoginMethod({ kind: 'password' }, { kind: 'password' })).toBe(true)
      expect(
        isSameLoginMethod(
          { kind: 'instance-sso', slug: 'google' },
          { kind: 'instance-sso', slug: 'github' }
        )
      ).toBe(false)
      expect(isSameLoginMethod(okta, { kind: 'org-sso', id: 'cfg-1' })).toBe(true)
      expect(isSameLoginMethod(okta, { kind: 'instance-sso', slug: 'cfg-1' })).toBe(false)
      expect(isSameLoginMethod(undefined, { kind: 'password' })).toBe(false)
    })
  })

  describe('subscribeToRememberedLogins', () => {
    test('notifies on same-tab and cross-tab changes, and unsubscribes', () => {
      const onChange = jest.fn()
      const unsubscribe = subscribeToRememberedLogins(onChange)

      rememberLogin('ada@acme.test', { kind: 'password' }, NOW)
      expect(onChange).toHaveBeenCalledTimes(1)

      window.dispatchEvent(new StorageEvent('storage', { key: LAST_LOGIN_STORAGE_KEY }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }))
      expect(onChange).toHaveBeenCalledTimes(2)

      unsubscribe()
      rememberLogin('bob@acme.test', { kind: 'password' }, NOW)
      expect(onChange).toHaveBeenCalledTimes(2)
    })
  })

  describe('syncLastLogin', () => {
    const session = (overrides: Record<string, unknown> = {}) => ({
      email: 'Ada@Acme.test',
      authMethod: 'sso',
      authSsoOrgId: null,
      authSsoProviderId: null,
      authSsoProviderSlug: null,
      ...overrides,
    })

    test('records a password session', () => {
      syncLastLogin(session({ authMethod: 'password' }), NOW)
      expect(getRememberedLogins(NOW)).toEqual([
        { email: 'ada@acme.test', method: { kind: 'password' }, lastUsedAt: NOW },
      ])
    })

    test('records the exact instance provider and consumes the matching attempt', () => {
      setPendingLogin({ kind: 'instance-sso', slug: 'google' }, NOW - 1000)
      syncLastLogin(session({ authSsoProviderSlug: 'google' }), NOW)

      expect(getRememberedLogins(NOW)[0].method).toEqual({ kind: 'instance-sso', slug: 'google' })
      expect(localStorage.getItem(PENDING_LOGIN_STORAGE_KEY)).toBeNull()
    })

    test('a cancelled attempt is never recorded and is left to expire', () => {
      // Clicked GitHub, bailed at the IdP, came back to an existing Google session
      setPendingLogin({ kind: 'instance-sso', slug: 'github' }, NOW - 1000)
      syncLastLogin(session({ authSsoProviderSlug: 'google' }), NOW)

      expect(getRememberedLogins(NOW)[0].method).toEqual({ kind: 'instance-sso', slug: 'google' })
      expect(stored(PENDING_LOGIN_STORAGE_KEY).method.slug).toBe('github')
    })

    test('org SSO keeps the display details captured at click time', () => {
      setPendingLogin(okta, NOW - 1000)
      syncLastLogin(session({ authSsoOrgId: 'org-1', authSsoProviderId: 'cfg-1' }), NOW)

      expect(getRememberedLogins(NOW)[0].method).toEqual(okta)
      expect(localStorage.getItem(PENDING_LOGIN_STORAGE_KEY)).toBeNull()
    })

    test('org SSO without an attempt reuses details already remembered', () => {
      rememberLogin('ada@acme.test', okta, NOW - 5000)
      syncLastLogin(session({ authSsoOrgId: 'org-1', authSsoProviderId: 'cfg-1' }), NOW)
      expect(getRememberedLogins(NOW)[0]).toEqual({
        email: 'ada@acme.test',
        method: okta,
        lastUsedAt: NOW,
      })
    })

    test('org SSO through a different provider records the bare config', () => {
      setPendingLogin(okta, NOW - 1000)
      syncLastLogin(session({ authSsoOrgId: 'org-2', authSsoProviderId: 'cfg-2' }), NOW)
      expect(getRememberedLogins(NOW)[0].method).toEqual({ kind: 'org-sso', id: 'cfg-2' })
      expect(stored(PENDING_LOGIN_STORAGE_KEY)).not.toBeNull()
    })

    test('expired attempts are discarded, not used', () => {
      setPendingLogin({ kind: 'instance-sso', slug: 'google' }, NOW - PENDING_LOGIN_TTL_MS - 1)
      syncLastLogin(session({ authSsoProviderSlug: 'github' }), NOW)

      expect(getRememberedLogins(NOW)[0].method).toEqual({ kind: 'instance-sso', slug: 'github' })
      expect(localStorage.getItem(PENDING_LOGIN_STORAGE_KEY)).toBeNull()
    })

    test('corrupt attempts are discarded', () => {
      localStorage.setItem(PENDING_LOGIN_STORAGE_KEY, '{"v":1,"method":{"kind":"password"}}')
      syncLastLogin(session({ authMethod: 'password' }), NOW)
      expect(localStorage.getItem(PENDING_LOGIN_STORAGE_KEY)).toBeNull()
    })

    describe('without per-provider markers (older backend)', () => {
      const legacy = (overrides: Record<string, unknown> = {}) => ({
        email: 'ada@acme.test',
        authMethod: 'sso',
        ...overrides,
      })

      test('trusts an attempt of the same SSO type', () => {
        setPendingLogin({ kind: 'instance-sso', slug: 'gitlab' }, NOW - 1000)
        syncLastLogin(legacy(), NOW)
        expect(getRememberedLogins(NOW)[0].method).toEqual({ kind: 'instance-sso', slug: 'gitlab' })
        expect(localStorage.getItem(PENDING_LOGIN_STORAGE_KEY)).toBeNull()
      })

      test('ignores an attempt of the other SSO type', () => {
        setPendingLogin({ kind: 'instance-sso', slug: 'gitlab' }, NOW - 1000)
        syncLastLogin(legacy({ authSsoOrgId: 'org-1' }), NOW)
        expect(getRememberedLogins(NOW)).toEqual([])
      })

      test('keeps a matching existing record fresh', () => {
        rememberLogin('ada@acme.test', okta, NOW - 5000)
        syncLastLogin(legacy({ authSsoOrgId: 'org-1' }), NOW)
        expect(getRememberedLogins(NOW)[0]).toEqual({
          email: 'ada@acme.test',
          method: okta,
          lastUsedAt: NOW,
        })
      })

      test('records nothing it cannot identify', () => {
        rememberLogin('ada@acme.test', { kind: 'password' }, NOW - 5000)
        syncLastLogin(legacy(), NOW)
        expect(getRememberedLogins(NOW)[0].method).toEqual({ kind: 'password' })
        expect(getRememberedLogins(NOW)[0].lastUsedAt).toBe(NOW - 5000)
      })
    })

    test('ignores sessions without a usable email', () => {
      syncLastLogin(session({ email: '', authMethod: 'password' }), NOW)
      expect(localStorage.getItem(LAST_LOGIN_STORAGE_KEY)).toBeNull()
    })

    test('clearPendingLogin removes the attempt', () => {
      setPendingLogin({ kind: 'instance-sso', slug: 'google' }, NOW)
      clearPendingLogin()
      expect(localStorage.getItem(PENDING_LOGIN_STORAGE_KEY)).toBeNull()
    })
  })
})
