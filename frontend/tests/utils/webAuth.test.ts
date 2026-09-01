import { expiryFromLifetime, parseWebAuthRequest } from '@/utils/webAuth'

describe('parseWebAuthRequest', () => {
  describe('JSON payload (new CLI)', () => {
    it('parses a JSON payload with a requested lifetime', () => {
      const decoded = JSON.stringify({
        port: 8002,
        publicKey: 'abc123',
        name: 'john@laptop',
        lifetime: 604800,
      })

      expect(parseWebAuthRequest(decoded)).toEqual({
        port: 8002,
        publicKey: 'abc123',
        requestedTokenName: 'john@laptop',
        requestedTokenLifetime: 604800,
      })
    })

    it('treats a missing lifetime as never-expiring', () => {
      const decoded = JSON.stringify({ port: 8002, publicKey: 'abc123', name: 'john@laptop' })

      expect(parseWebAuthRequest(decoded).requestedTokenLifetime).toBeNull()
    })

    it('treats a non-positive lifetime as never-expiring', () => {
      const decoded = JSON.stringify({
        port: 8002,
        publicKey: 'abc123',
        name: 'john@laptop',
        lifetime: 0,
      })

      expect(parseWebAuthRequest(decoded).requestedTokenLifetime).toBeNull()
    })

    it('preserves a token name containing hyphens', () => {
      const decoded = JSON.stringify({
        port: 8002,
        publicKey: 'abc123',
        name: 'john@my-dev-laptop',
        lifetime: 3600,
      })

      expect(parseWebAuthRequest(decoded).requestedTokenName).toBe('john@my-dev-laptop')
    })
  })

  describe('legacy hyphen-joined payload (old CLI)', () => {
    it('parses the legacy `port-pubKeyHex-patName` format with no lifetime', () => {
      expect(parseWebAuthRequest('8002-abc123-john@laptop')).toEqual({
        port: 8002,
        publicKey: 'abc123',
        requestedTokenName: 'john@laptop',
        requestedTokenLifetime: null,
      })
    })

    it('keeps a token name that itself contains hyphens', () => {
      expect(parseWebAuthRequest('8002-abc123-john@my-dev-laptop').requestedTokenName).toBe(
        'john@my-dev-laptop'
      )
    })

    it('falls back to the legacy parse when the payload is valid JSON but not an object', () => {
      // `8002` parses as a JSON number; the non-object guard must reject it and use the legacy path.
      expect(parseWebAuthRequest('8002')).toEqual({
        port: 8002,
        publicKey: '',
        requestedTokenName: '',
        requestedTokenLifetime: null,
      })
    })
  })
})

describe('expiryFromLifetime', () => {
  it('returns null for a null lifetime', () => {
    expect(expiryFromLifetime(null)).toBeNull()
  })

  it('returns null for a zero lifetime', () => {
    expect(expiryFromLifetime(0)).toBeNull()
  })

  it('returns an absolute ms timestamp lifetime seconds in the future', () => {
    const now = Date.now()
    const expiry = expiryFromLifetime(604800)

    expect(expiry).not.toBeNull()
    expect(expiry!).toBeGreaterThanOrEqual(now + 604800 * 1000)
  })
})
