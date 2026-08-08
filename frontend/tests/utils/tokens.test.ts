import { humanReadableExpiryTimestamp } from '@/utils/tokens'

describe('humanReadableExpiryTimestamp', () => {
  it('describes a null expiry as never expiring', () => {
    expect(humanReadableExpiryTimestamp(null)).toBe('This token will never expire.')
  })

  it('describes a timestamp as a localized expiry date', () => {
    const expiry = 1700000000000
    expect(humanReadableExpiryTimestamp(expiry)).toBe(
      `This token will expire on ${new Date(expiry).toLocaleDateString()}.`
    )
  })
})
