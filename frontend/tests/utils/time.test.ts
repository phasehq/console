import { relativeTimeFromDates, shortRelativeTimeFromDates } from '@/utils/time'

describe('relative time', () => {
  const pivot = new Date('2026-10-06T12:00:00Z')
  const ago = (ms: number) => new Date(pivot.getTime() - ms)

  it('keeps the long style by default', () => {
    expect(relativeTimeFromDates(ago(4 * 60_000), pivot)).toBe('4 minutes ago')
  })

  it('has a compact style for dense lists', () => {
    expect(shortRelativeTimeFromDates(ago(4 * 60_000), pivot)).toMatch(/^4\s?m(in\.?)? ago$/)
    expect(shortRelativeTimeFromDates(ago(26 * 3_600_000), pivot)).toBe('yesterday')
  })
})
