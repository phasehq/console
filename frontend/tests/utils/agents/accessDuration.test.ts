import {
  UNTIL_REVOKED,
  accessEndsValue,
  customSeconds,
  describeDuration,
  describeExpiry,
  grantDurationResult,
  initialGrantDuration,
  settingsProblem,
} from '@/utils/agents/accessDuration'

const NOW = Date.parse('2026-11-14T10:00:00Z')

describe('how long access lasts', () => {
  test('words a duration in its natural unit', () => {
    expect(describeDuration(3600)).toBe('1 hour')
    expect(describeDuration(8 * 3600)).toBe('8 hours')
    expect(describeDuration(7 * 86400)).toBe('7 days')
    expect(describeDuration(300)).toBe('5 minutes')
    expect(describeDuration(5400)).toBe('90 minutes')
    expect(describeDuration(2592000)).toBe('30 days')
  })

  test('words when access ends, and when it ended', () => {
    expect(describeExpiry('2026-11-14T13:00:00Z', NOW)).toBe('Ends in 3 hours')
    expect(describeExpiry('2026-11-14T10:30:00Z', NOW)).toBe('Ends in 30 minutes')
    expect(describeExpiry('2026-11-16T10:00:00Z', NOW)).toBe('Ends in 2 days')
    expect(describeExpiry('2026-11-12T10:00:00Z', NOW)).toBe('Ended 2 days ago')
    expect(describeExpiry(null, NOW)).toBe('')
  })

  test('"Access ends" is until revoked by default and a time from now otherwise', () => {
    expect(accessEndsValue(UNTIL_REVOKED, NOW)).toEqual({ expiresAt: null, problem: '' })
    expect(accessEndsValue({ choice: '1h', custom: '' }, NOW).expiresAt).toBe(
      '2026-11-14T11:00:00.000Z'
    )
    expect(accessEndsValue({ choice: '8h', custom: '' }, NOW).expiresAt).toBe(
      '2026-11-14T18:00:00.000Z'
    )
    expect(accessEndsValue({ choice: '24h', custom: '' }, NOW).expiresAt).toBe(
      '2026-11-15T10:00:00.000Z'
    )
    expect(accessEndsValue({ choice: '7d', custom: '' }, NOW).expiresAt).toBe(
      '2026-11-21T10:00:00.000Z'
    )
  })

  test('a custom end must be a time in the future', () => {
    expect(accessEndsValue({ choice: 'custom', custom: '' }, NOW).problem).toMatch(/Choose when/)
    expect(accessEndsValue({ choice: 'custom', custom: '2020-01-01T00:00' }, NOW).problem).toMatch(
      /future/
    )
    const future = accessEndsValue({ choice: 'custom', custom: '2099-01-01T00:00' }, NOW)
    expect(future.problem).toBe('')
    expect(future.expiresAt).toMatch(/^2099-/)
  })
})

describe('the duration an approval grants', () => {
  test('starts at the requested duration, on a standard choice when it is one', () => {
    expect(initialGrantDuration(3600, true).choice).toBe('1h')
    expect(initialGrantDuration(86400, true).choice).toBe('24h')
    const odd = initialGrantDuration(5400, true)
    expect(odd).toMatchObject({ choice: 'requested', amount: '90', unit: 'minutes' })
    expect(initialGrantDuration(null, true).choice).toBe('forever')
    // An allow cannot be until revoked, so it does not start there.
    expect(initialGrantDuration(null, false).choice).toBe('1h')
  })

  test('sends the requested duration as it is', () => {
    const start = initialGrantDuration(5400, true)
    expect(grantDurationResult(start, 5400, { allowUntilRevoked: true })).toEqual({
      args: { durationSeconds: 5400 },
      seconds: 5400,
      problem: '',
    })
  })

  test('sends a chosen standard duration, a custom one, or until revoked', () => {
    const base = initialGrantDuration(3600, true)
    expect(
      grantDurationResult({ ...base, choice: '7d' }, 3600, { allowUntilRevoked: true }).args
    ).toEqual({
      durationSeconds: 604800,
    })
    expect(
      grantDurationResult({ choice: 'custom', amount: '3', unit: 'hours' }, 3600, {
        allowUntilRevoked: true,
      }).args
    ).toEqual({ durationSeconds: 10800 })
    expect(
      grantDurationResult({ ...base, choice: 'forever' }, 3600, { allowUntilRevoked: true }).args
    ).toEqual({
      untilRevoked: true,
    })
  })

  test('refuses until revoked where access always ends', () => {
    const result = grantDurationResult(
      { ...initialGrantDuration(3600, false), choice: 'forever' },
      3600,
      {
        allowUntilRevoked: false,
      }
    )
    expect(result.args).toBeNull()
    expect(result.problem).toMatch(/always ends/)
  })

  test('holds an allow to the organisation maximum, and everything to the backend bounds', () => {
    const custom = (amount: string, unit: 'minutes' | 'hours' | 'days') =>
      ({ choice: 'custom', amount, unit }) as const
    expect(
      grantDurationResult(custom('2', 'days'), 3600, {
        allowUntilRevoked: false,
        maximumSeconds: 86400,
      }).problem
    ).toMatch(/at most 1 day/)
    expect(
      grantDurationResult(custom('1', 'days'), 3600, {
        allowUntilRevoked: false,
        maximumSeconds: 86400,
      }).problem
    ).toBe('')
    expect(
      grantDurationResult(custom('4', 'minutes'), 3600, { allowUntilRevoked: true }).problem
    ).toMatch(/at least 5 minutes/)
    expect(
      grantDurationResult(custom('31', 'days'), 3600, { allowUntilRevoked: true }).problem
    ).toMatch(/at most 30 days/)
    expect(
      grantDurationResult(custom('', 'days'), 3600, { allowUntilRevoked: true }).problem
    ).toMatch(/whole number/)
    expect(customSeconds('1.5', 'hours')).toBeNull()
  })
})

describe('the organisation setting', () => {
  const bounds = { min: 300, max: 2592000 }
  test('accepts a default no longer than the maximum, both within bounds', () => {
    expect(settingsProblem(86400, 3600, bounds)).toBe('')
    expect(settingsProblem(3600, 3600, bounds)).toBe('')
    expect(settingsProblem(300, 300, bounds)).toBe('')
    expect(settingsProblem(2592000, 300, bounds)).toBe('')
  })

  test('refuses anything the backend would', () => {
    expect(settingsProblem(null, 3600, bounds)).toMatch(/whole number/)
    expect(settingsProblem(299, 299, bounds)).toMatch(/maximum must be/)
    expect(settingsProblem(2592001, 3600, bounds)).toMatch(/maximum must be/)
    expect(settingsProblem(3600, 299, bounds)).toMatch(/default must be/)
    expect(settingsProblem(3600, 7200, bounds)).toMatch(/cannot be longer than the maximum/)
  })
})
