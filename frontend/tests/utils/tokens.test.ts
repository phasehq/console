import { defaultTokenName } from '@/utils/tokens'

describe('defaultTokenName', () => {
  const date = new Date(2026, 9, 5)

  it('appends the local date to the subject', () => {
    expect(defaultTokenName('ci-deployer', date)).toBe('ci-deployer-2026-10-05')
    expect(defaultTokenName(' my service ', date)).toBe('my-service-2026-10-05')
  })

  it('keeps names within the 64-character limit, date included', () => {
    const name = defaultTokenName('x'.repeat(80), date)
    expect(name).toHaveLength(64)
    expect(name.endsWith('-2026-10-05')).toBe(true)
  })

  it('falls back to the date alone', () => {
    expect(defaultTokenName('  ', date)).toBe('2026-10-05')
  })
})
