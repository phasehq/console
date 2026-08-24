import { accountErrorMessage, isReauthError } from '@/utils/accountErrors'

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
