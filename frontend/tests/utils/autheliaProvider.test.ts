import { AutheliaProvider } from '@/ee/authentication/sso/oidc/util/autheliaProvider'
import { OIDCProvider } from '@/ee/authentication/sso/oidc/util/genericOIDCProvider'

// Suppress debug logging from the provider
jest.spyOn(console, 'log').mockImplementation(() => {})

// ─── Fixtures from a real Authelia login flow ───────────────────────────────

const autheliaIdTokenClaims = {
  amr: ['pwd', 'kba'],
  at_hash: 'o1-g5CUAK6BoVgCWRvj5cw',
  aud: ['phase-console'],
  auth_time: 1774503606,
  azp: 'phase-console',
  exp: 1774508274,
  iat: 1774504674,
  iss: 'https://auth.example.com',
  jti: '6ee8b8a7-138b-45de-88d2-c70498a53867',
  nonce: 'test-nonce-value',
  sub: '79e01414-21b4-49b1-9b61-f9774b980350',
}

const autheliaUserinfo = {
  email: 'testuser@example.com',
  email_verified: true,
  name: 'Test User',
  preferred_username: 'testuser',
  rat: 1774504670,
  sub: '79e01414-21b4-49b1-9b61-f9774b980350',
  updated_at: 1774504675,
}

const tokens = {
  access_token: 'authelia_at_test_access_token',
  expires_at: 1774508273,
  id_token: 'eyJ...',
  token_type: 'bearer',
  scope: 'openid email profile',
}

// ─── AutheliaProvider Tests ─────────────────────────────────────────────────

describe('AutheliaProvider', () => {
  const baseOptions = {
    clientId: 'phase-console',
    clientSecret: 'test-secret',
    issuer: 'https://auth.example.com',
  }

  describe('configuration', () => {
    test('returns correct default id, name, and type', () => {
      const provider = AutheliaProvider(baseOptions)

      expect(provider.id).toBe('authelia')
      expect(provider.name).toBe('Authelia')
      expect(provider.type).toBe('oauth')
    })

    test('sets wellKnown URL from issuer', () => {
      const provider = AutheliaProvider(baseOptions)

      expect(provider.wellKnown).toBe(
        'https://auth.example.com/.well-known/openid-configuration'
      )
    })

    test('passes clientId and clientSecret through', () => {
      const provider = AutheliaProvider(baseOptions)

      expect(provider.clientId).toBe('phase-console')
      expect(provider.clientSecret).toBe('test-secret')
    })

    test('enables idToken and sets security checks', () => {
      const provider = AutheliaProvider(baseOptions)

      expect(provider.idToken).toBe(true)
      expect(provider.checks).toEqual(['pkce', 'state', 'nonce'])
    })

    test('sets client token_endpoint_auth_method to client_secret_post', () => {
      const provider = AutheliaProvider(baseOptions)

      expect(provider.client).toEqual({
        token_endpoint_auth_method: 'client_secret_post',
      })
    })

    test('sets authorization scope to openid email profile', () => {
      const provider = AutheliaProvider(baseOptions)

      expect(provider.authorization).toEqual({
        params: { scope: 'openid email profile' },
      })
    })
  })

  describe('custom id and name', () => {
    test('allows overriding the provider id', () => {
      const provider = AutheliaProvider({ ...baseOptions, id: 'my-authelia' })

      expect(provider.id).toBe('my-authelia')
    })

    test('allows overriding the provider name', () => {
      const provider = AutheliaProvider({ ...baseOptions, name: 'My Authelia SSO' })

      expect(provider.name).toBe('My Authelia SSO')
    })
  })

  describe('issuer validation', () => {
    test('throws when issuer is an empty string', () => {
      expect(() =>
        AutheliaProvider({ ...baseOptions, issuer: '' })
      ).toThrow('AUTHELIA_URL must be set')
    })
  })

  describe('profile callback', () => {
    const originalFetch = global.fetch

    beforeEach(() => {
      jest.clearAllMocks()
    })

    afterAll(() => {
      global.fetch = originalFetch
    })

    test('fetches userinfo with correct Bearer token and returns profile', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        json: async () => autheliaUserinfo,
      })

      const provider = AutheliaProvider(baseOptions)
      const profile = await provider.profile!(autheliaIdTokenClaims as any, tokens as any)

      expect(global.fetch).toHaveBeenCalledWith(
        'https://auth.example.com/api/oidc/userinfo',
        { headers: { Authorization: 'Bearer authelia_at_test_access_token' } }
      )

      expect(profile).toEqual({
        id: '79e01414-21b4-49b1-9b61-f9774b980350',
        name: 'Test User',
        email: 'testuser@example.com',
        image: '',
      })
    })

    test('falls back to empty strings when userinfo fields are missing', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        json: async () => ({
          sub: 'minimal-sub',
        }),
      })

      const provider = AutheliaProvider(baseOptions)
      const profile = await provider.profile!(autheliaIdTokenClaims as any, tokens as any)

      expect(profile).toEqual({
        id: 'minimal-sub',
        name: '',
        email: '',
        image: '',
      })
    })

    test('uses preferred_username as name fallback when name is missing', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        json: async () => ({
          sub: '79e01414-21b4-49b1-9b61-f9774b980350',
          preferred_username: 'testuser',
          email: 'testuser@example.com',
        }),
      })

      const provider = AutheliaProvider(baseOptions)
      const profile = await provider.profile!(autheliaIdTokenClaims as any, tokens as any)

      expect(profile.name).toBe('testuser')
    })

    test('uses picture from userinfo when present', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        json: async () => ({
          ...autheliaUserinfo,
          picture: 'https://auth.example.com/avatar.png',
        }),
      })

      const provider = AutheliaProvider(baseOptions)
      const profile = await provider.profile!(autheliaIdTokenClaims as any, tokens as any)

      expect(profile.image).toBe('https://auth.example.com/avatar.png')
    })
  })
})

// ─── OIDCProvider Tests ─────────────────────────────────────────────────────

describe('OIDCProvider', () => {
  const baseConfig = {
    id: 'my-oidc',
    name: 'My OIDC',
    clientId: 'oidc-client-id',
    clientSecret: 'oidc-client-secret',
    issuer: 'https://idp.example.com',
  } as any

  describe('configuration defaults', () => {
    test('sets type to oauth', () => {
      const provider = OIDCProvider(baseConfig)

      expect(provider.type).toBe('oauth')
    })

    test('sets authorization params with response_type, scope, and access_type', () => {
      const provider = OIDCProvider(baseConfig)

      expect(provider.authorization).toEqual({
        params: {
          response_type: 'code',
          scope: 'openid email profile',
          access_type: 'offline',
        },
      })
    })

    test('sets token params with grant_type authorization_code', () => {
      const provider = OIDCProvider(baseConfig)

      expect(provider.token).toEqual({
        params: { grant_type: 'authorization_code' },
      })
    })

    test('enables idToken and sets security checks', () => {
      const provider = OIDCProvider(baseConfig)

      expect(provider.idToken).toBe(true)
      expect(provider.checks).toEqual(['pkce', 'state', 'nonce'])
    })

    test('sets client token_endpoint_auth_method to client_secret_post', () => {
      const provider = OIDCProvider(baseConfig)

      expect(provider.client).toEqual({
        token_endpoint_auth_method: 'client_secret_post',
      })
    })
  })

  describe('config spreading behavior', () => {
    test('defaults override caller-provided authorization params', () => {
      // The implementation spreads config first (...config), then sets defaults after,
      // so the hardcoded authorization/token/idToken/checks/client always win.
      const provider = OIDCProvider({
        ...baseConfig,
        authorization: { params: { scope: 'custom-scope' } },
      } as any)

      // The hardcoded value overwrites the caller's value
      expect(provider.authorization).toEqual({
        params: {
          response_type: 'code',
          scope: 'openid email profile',
          access_type: 'offline',
        },
      })
    })

    test('defaults override caller-provided idToken value', () => {
      const provider = OIDCProvider({
        ...baseConfig,
        idToken: false,
      } as any)

      expect(provider.idToken).toBe(true)
    })

    test('preserves wellKnown from config', () => {
      const provider = OIDCProvider({
        ...baseConfig,
        wellKnown: 'https://idp.example.com/.well-known/openid-configuration',
      })

      expect(provider.wellKnown).toBe(
        'https://idp.example.com/.well-known/openid-configuration'
      )
    })

    test('wellKnown is undefined when not provided', () => {
      const provider = OIDCProvider(baseConfig)

      expect(provider.wellKnown).toBeUndefined()
    })
  })

  describe('profile function', () => {
    test('returns correct profile shape from valid OIDC claims', () => {
      const provider = OIDCProvider(baseConfig)

      const result = (provider.profile as Function)({
        sub: 'user-123',
        name: 'Jane Doe',
        email: 'jane@example.com',
        picture: 'https://example.com/jane.png',
      })

      expect(result).toEqual({
        id: 'user-123',
        name: 'Jane Doe',
        email: 'jane@example.com',
        image: 'https://example.com/jane.png',
      })
    })

    test('falls back to empty strings for missing optional fields', () => {
      const provider = OIDCProvider(baseConfig)

      const result = (provider.profile as Function)({ sub: 'user-456' })

      expect(result).toEqual({
        id: 'user-456',
        name: '',
        email: '',
        image: '',
      })
    })

    test('throws when sub claim is missing', () => {
      const provider = OIDCProvider(baseConfig)

      expect(() =>
        (provider.profile as Function)({ name: 'No Sub User', email: 'nosub@example.com' })
      ).toThrow('No sub claim in OIDC profile')
    })

    test('throws when sub claim is an empty string', () => {
      const provider = OIDCProvider(baseConfig)

      expect(() =>
        (provider.profile as Function)({ sub: '', name: 'Empty Sub' })
      ).toThrow('No sub claim in OIDC profile')
    })
  })
})
