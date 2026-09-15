import { isCredentialSecret } from '@/utils/syncing/general'

describe('isCredentialSecret', () => {
  const postgresPlainFields = ['username', 'host', 'port', 'database']

  test('uses the provider-declared non-sensitive fields', () => {
    expect(isCredentialSecret('username', postgresPlainFields)).toBe(false)
    expect(isCredentialSecret('host', postgresPlainFields)).toBe(false)
    expect(isCredentialSecret('port', postgresPlainFields)).toBe(false)
    expect(isCredentialSecret('database', postgresPlainFields)).toBe(false)
    expect(isCredentialSecret('password', postgresPlainFields)).toBe(true)
  })

  test('masks unknown fields and missing provider metadata by default', () => {
    expect(isCredentialSecret('future_sensitive_field', postgresPlainFields)).toBe(true)
    expect(isCredentialSecret('host')).toBe(true)
    expect(isCredentialSecret('host_url', ['host'])).toBe(true)
  })
})
