import { getAvailableSeats } from '@/utils/organisation'

describe('getAvailableSeats', () => {
  it('returns Infinity when the plan has no seat cap (null seatLimit)', () => {
    // self-hosted free plan: backend returns seat_limit = null
    expect(getAvailableSeats(null, 3)).toBe(Infinity)
    expect(getAvailableSeats(undefined, 15)).toBe(Infinity)
  })

  it('returns remaining seats for a capped plan', () => {
    expect(getAvailableSeats(10, 3)).toBe(7)
    expect(getAvailableSeats(5, 0)).toBe(5)
  })

  it('treats missing seatsUsed as zero', () => {
    expect(getAvailableSeats(10, null)).toBe(10)
    expect(getAvailableSeats(10, undefined)).toBe(10)
  })

  it('returns 0 when the plan is exactly full', () => {
    expect(getAvailableSeats(5, 5)).toBe(0)
  })

  it('returns a negative number when over capacity', () => {
    expect(getAvailableSeats(5, 8)).toBe(-3)
  })
})
