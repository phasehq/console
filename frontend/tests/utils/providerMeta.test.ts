import {
  getProviderName,
  orgProviderIcons,
  providerButtons,
  providerIdIcons,
} from '@/components/auth/providerMeta'

describe('providerMeta', () => {
  test('provider button slugs are unique', () => {
    const ids = providerButtons.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every instance provider has an icon and a name', () => {
    providerButtons.forEach((p) => {
      expect(p.icon).toBeDefined()
      expect(p.name.length).toBeGreaterThan(0)
    })
  })

  test('providerIdIcons covers every provider_id the backend can return', () => {
    // Keep in sync with SSO_PROVIDER_REGISTRY provider_id values and
    // ORG_SSO_PROVIDER_REGISTRY (backend/api/utils/sso.py)
    const backendProviderIds = [
      'google',
      'google-oidc',
      'github',
      'github-enterprise',
      'gitlab',
      'microsoft',
      'jumpcloud-oidc',
      'okta-oidc',
      'authentik',
      'authelia',
    ]
    backendProviderIds.forEach((id) => {
      expect(providerIdIcons[id]).toBeDefined()
    })
  })

  test('org provider types map to icons', () => {
    expect(orgProviderIcons['entra_id']).toBeDefined()
    expect(orgProviderIcons['okta']).toBeDefined()
  })

  test('getProviderName resolves known slugs and falls back to the id', () => {
    expect(getProviderName('google')).toBe('Google')
    expect(getProviderName('entra-id-oidc')).toBe('Entra ID OIDC')
    expect(getProviderName('unknown-slug')).toBe('unknown-slug')
  })
})
