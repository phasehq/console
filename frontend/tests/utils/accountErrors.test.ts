import { accountErrorMessage } from '@/utils/accountErrors'

describe('accountErrorMessage', () => {
  test('maps known backend codes to user-facing copy', () => {
    expect(accountErrorMessage('identity_in_use')).toMatch(/already linked to a different account/)
    expect(accountErrorMessage('not_verified')).toMatch(/unverified/)
    expect(accountErrorMessage('session_changed')).toMatch(/session changed/i)
    expect(accountErrorMessage('not_a_member')).toMatch(/not a member/)
    expect(accountErrorMessage('last_method')).toMatch(/at least one sign-in method/)
    expect(accountErrorMessage('org_enforced')).toMatch(/requires this sign-in method/)
    expect(accountErrorMessage('scim_managed')).toMatch(/manages this sign-in method/)
  })

  test('falls back to a generic message including the raw code', () => {
    expect(accountErrorMessage('mystery_code')).toContain('mystery_code')
  })
})
