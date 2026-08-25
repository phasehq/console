import {
  accountErrorMessage,
  buildReauthUrl,
  isReauthError,
  reauthRedirectUrl,
  registerReauthPromptListener,
  registerReauthState,
  requestReauthPrompt,
  REAUTH_URL,
} from '@/utils/accountErrors'

describe('accountErrorMessage', () => {
  test('maps known backend codes to user-facing copy', () => {
    expect(accountErrorMessage('identity_in_use')).toMatch(/already linked to a different account/)
    expect(accountErrorMessage('not_verified')).toMatch(/unverified/)
    expect(accountErrorMessage('session_changed')).toMatch(/session changed/i)
    expect(accountErrorMessage('not_a_member')).toMatch(/not a member/)
    expect(accountErrorMessage('last_method')).toMatch(/at least one sign-in method/)
    expect(accountErrorMessage('org_enforced')).toMatch(/requires this sign-in method/)
    expect(accountErrorMessage('scim_managed')).toMatch(/manages this sign-in method/)
    expect(accountErrorMessage('sso_config_not_found')).toMatch(/no longer configured/)
    expect(accountErrorMessage('unknown_provider')).toMatch(/not supported/)
  })

  test('falls back to a generic message that does not echo the raw code', () => {
    // Backend/IdP error strings must not be surfaced verbatim.
    expect(accountErrorMessage('mystery_code')).not.toContain('mystery_code')
    expect(accountErrorMessage('mystery_code')).toMatch(/something went wrong/i)
  })
})

describe('isReauthError', () => {
  test('detects the fresh-session gate error', () => {
    expect(isReauthError('reauth_required')).toBe(true)
    expect(isReauthError('GraphQL error: reauth_required')).toBe(true)
  })
  test('ignores unrelated messages and nullish input', () => {
    expect(isReauthError('some other error')).toBe(false)
    expect(isReauthError(undefined)).toBe(false)
    expect(isReauthError(null)).toBe(false)
  })
})

describe('buildReauthUrl', () => {
  test('encodes the return path into the login callbackUrl', () => {
    expect(buildReauthUrl('/account')).toBe('/login?callbackUrl=%2Faccount&reauth=1')
    expect(buildReauthUrl('/account?action=email&step=verify')).toBe(
      '/login?callbackUrl=%2Faccount%3Faction%3Demail%26step%3Dverify&reauth=1'
    )
  })

  test('REAUTH_URL keeps its historical shape', () => {
    expect(REAUTH_URL).toBe('/login?callbackUrl=%2Faccount&reauth=1')
  })
})

describe('reauthRedirectUrl', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  test('returns to the current path when no dialog state is registered', () => {
    window.history.replaceState(null, '', '/account')
    expect(reauthRedirectUrl()).toBe('/login?callbackUrl=%2Faccount&reauth=1')
  })

  test('drops stale search params from the current URL', () => {
    window.history.replaceState(null, '', '/account?linked=github')
    expect(reauthRedirectUrl()).toBe('/login?callbackUrl=%2Faccount&reauth=1')
  })

  test('carries the registered dialog state in the callbackUrl', () => {
    window.history.replaceState(null, '', '/account')
    const unregister = registerReauthState(() => ({
      action: 'email',
      step: 'verify',
      newEmail: 'new@example.com',
    }))
    expect(reauthRedirectUrl()).toBe(
      `/login?callbackUrl=${encodeURIComponent(
        '/account?action=email&step=verify&newEmail=new%40example.com'
      )}&reauth=1`
    )
    unregister()
    expect(reauthRedirectUrl()).toBe('/login?callbackUrl=%2Faccount&reauth=1')
  })

  test('unregister only clears its own getter', () => {
    window.history.replaceState(null, '', '/account')
    const unregisterOld = registerReauthState(() => ({ action: 'delete' }))
    const unregisterNew = registerReauthState(() => ({ action: 'unlink', identity: 'id-1' }))
    // An out-of-order cleanup from a closed dialog must not drop the newer one.
    unregisterOld()
    expect(reauthRedirectUrl()).toBe(
      `/login?callbackUrl=${encodeURIComponent('/account?action=unlink&identity=id-1')}&reauth=1`
    )
    unregisterNew()
  })

  test('ignores an empty state object', () => {
    window.history.replaceState(null, '', '/account')
    const unregister = registerReauthState(() => ({}))
    expect(reauthRedirectUrl()).toBe('/login?callbackUrl=%2Faccount&reauth=1')
    unregister()
  })
})

describe('requestReauthPrompt', () => {
  test('returns false when no prompt is mounted — caller hard-redirects', () => {
    expect(requestReauthPrompt('/login?callbackUrl=%2Faccount&reauth=1')).toBe(false)
  })

  test('delivers the login URL to the mounted prompt', () => {
    const seen: string[] = []
    const unregister = registerReauthPromptListener((url) => seen.push(url))
    expect(requestReauthPrompt('/login?callbackUrl=%2Faccount&reauth=1')).toBe(true)
    expect(seen).toEqual(['/login?callbackUrl=%2Faccount&reauth=1'])
    unregister()
    expect(requestReauthPrompt('/login?callbackUrl=%2Faccount&reauth=1')).toBe(false)
  })

  test('unregister only clears its own listener', () => {
    const unregisterOld = registerReauthPromptListener(() => {})
    const seen: string[] = []
    const unregisterNew = registerReauthPromptListener((url) => seen.push(url))
    unregisterOld()
    expect(requestReauthPrompt('/login?x=1')).toBe(true)
    expect(seen).toEqual(['/login?x=1'])
    unregisterNew()
  })
})
