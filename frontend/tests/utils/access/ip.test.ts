import { isClientIpAllowed, isValidCidr } from '@/utils/access/ip'

describe('isValidCidr', () => {
  test('accepts ordinary IPv4 and IPv6 CIDR ranges', () => {
    expect(isValidCidr('10.0.0.0/24')).toBe(true)
    expect(isValidCidr('192.168.1.1/32')).toBe(true)
    expect(isValidCidr('0.0.0.0/0')).toBe(true)
    expect(isValidCidr('::1/128')).toBe(true)
    expect(isValidCidr('2001:db8::/32')).toBe(true)
  })

  test('rejects a prefix with trailing non-numeric characters', () => {
    // parseInt('24abc', 10) is 24, so these used to pass client-side validation
    expect(isValidCidr('10.0.0.0/24abc')).toBe(false)
    expect(isValidCidr('2001:db8::/64foo')).toBe(false)
  })

  test('rejects malformed prefix syntax', () => {
    expect(isValidCidr('10.0.0.0/24/8')).toBe(false)
    expect(isValidCidr('10.0.0.0/')).toBe(false)
    expect(isValidCidr('10.0.0.0')).toBe(false)
    expect(isValidCidr('10.0.0.0/-1')).toBe(false)
    expect(isValidCidr('10.0.0.0/+24')).toBe(false)
    expect(isValidCidr('10.0.0.0/ 24')).toBe(false)
    expect(isValidCidr('10.0.0.0/24.5')).toBe(false)
  })

  test('rejects prefixes outside the address family range', () => {
    expect(isValidCidr('10.0.0.0/33')).toBe(false)
    expect(isValidCidr('::1/129')).toBe(false)
  })
})

describe('isClientIpAllowed', () => {
  test('allows an exact IP, a valid range, and an empty list', () => {
    expect(isClientIpAllowed(['10.0.0.5'], '10.0.0.5')).toBe(true)
    expect(isClientIpAllowed(['10.0.0.0/24'], '10.0.0.5')).toBe(true)
    expect(isClientIpAllowed([], '10.0.0.5')).toBe(true)
  })

  test('does not treat a malformed CIDR entry as a match', () => {
    // The network policy form uses this to warn before locking out the
    // caller's own IP. A malformed entry used to be parsed as /24, so the
    // warning stayed silent even though the backend ignores that entry.
    expect(isClientIpAllowed(['10.0.0.0/24abc'], '10.0.0.5')).toBe(false)
    expect(isClientIpAllowed(['10.0.0.0/24/8'], '10.0.0.5')).toBe(false)
  })
})
