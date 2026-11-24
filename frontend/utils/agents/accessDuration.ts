/**
 * How long access lasts: the choices a member sees and how an expiry is worded. Bounds
 * mirror the backend's: an Agent may ask for 300 seconds to 30 days.
 */

export const MIN_DURATION_SECONDS = 300
export const MAX_DURATION_SECONDS = 2592000

const HOUR = 3600
const DAY = 86400

/** The longest a member may grant when approving, as the backend allows. */
export const MAX_GRANTED_SECONDS = 10 * 365 * DAY

export const DURATION_CHOICES = [
  { value: '1h', label: '1 hour', seconds: HOUR },
  { value: '8h', label: '8 hours', seconds: 8 * HOUR },
  { value: '24h', label: '24 hours', seconds: DAY },
  { value: '7d', label: '7 days', seconds: 7 * DAY },
] as const

export type DurationChoice =
  | 'forever'
  | 'requested'
  | 'custom'
  | (typeof DURATION_CHOICES)[number]['value']

export const DURATION_UNITS = [
  { value: 'minutes', label: 'minutes', seconds: 60 },
  { value: 'hours', label: 'hours', seconds: HOUR },
  { value: 'days', label: 'days', seconds: DAY },
] as const
export type DurationUnit = (typeof DURATION_UNITS)[number]['value']

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** 3600 is "1 hour", 90 minutes stays "90 minutes", 2592000 is "30 days". */
export const describeDuration = (seconds: number): string => {
  if (seconds % DAY === 0) return plural(seconds / DAY, 'day')
  if (seconds % HOUR === 0) return plural(seconds / HOUR, 'hour')
  if (seconds % 60 === 0) return plural(seconds / 60, 'minute')
  return plural(seconds, 'second')
}

const SPANS: Array<[number, string]> = [
  [DAY, 'day'],
  [HOUR, 'hour'],
  [60, 'minute'],
]

const span = (seconds: number) => {
  for (const [size, word] of SPANS) {
    if (seconds >= size) return plural(Math.floor(seconds / size), word)
  }
  return 'less than a minute'
}

/** "Ends in 3 hours", "Ended 2 days ago"; '' when there is no expiry. */
export const describeExpiry = (expiresAt?: string | null, now = Date.now()): string => {
  if (!expiresAt) return ''
  const at = Date.parse(expiresAt)
  if (Number.isNaN(at)) return ''
  const seconds = Math.round((at - now) / 1000)
  return seconds > 0 ? `Ends in ${span(seconds)}` : `Ended ${span(-seconds)} ago`
}

// --- The "Access ends" field of a grant ----------------------------------

export type AccessEnds = { choice: DurationChoice; custom: string }

/** Until revoked unless something else is picked. */
export const UNTIL_REVOKED: AccessEnds = { choice: 'forever', custom: '' }

/** A `datetime-local` value is the member's local time, without a zone. */
export const toLocalInputValue = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

/**
 * The expiry an "Access ends" choice stands for: an ISO time, or null for
 * until revoked. `problem` says why a custom time cannot be used.
 */
export const accessEndsValue = (
  ends: AccessEnds,
  now = Date.now()
): { expiresAt: string | null; problem: string } => {
  if (ends.choice === 'forever') return { expiresAt: null, problem: '' }
  if (ends.choice === 'custom') {
    const at = ends.custom ? new Date(ends.custom).valueOf() : NaN
    if (Number.isNaN(at)) return { expiresAt: null, problem: 'Choose when access ends.' }
    if (at <= now) return { expiresAt: null, problem: 'Choose a time in the future.' }
    return { expiresAt: new Date(at).toISOString(), problem: '' }
  }
  const preset = DURATION_CHOICES.find((choice) => choice.value === ends.choice)
  if (!preset) return { expiresAt: null, problem: '' }
  return { expiresAt: new Date(now + preset.seconds * 1000).toISOString(), problem: '' }
}

// --- The "Grant access for" field of an approval -------------------------

export type GrantDuration = {
  choice: DurationChoice
  amount: string
  unit: DurationUnit
}

/** A duration as the largest unit that holds it exactly, for an amount and unit input. */
export const splitDuration = (seconds: number): { amount: number; unit: DurationUnit } => {
  if (seconds % DAY === 0) return { amount: seconds / DAY, unit: 'days' }
  if (seconds % HOUR === 0) return { amount: seconds / HOUR, unit: 'hours' }
  return { amount: Math.max(1, Math.round(seconds / 60)), unit: 'minutes' }
}

/**
 * Starting value: the requested duration, or the organisation default when none was
 * asked. Falls back to until revoked, or one hour where that is refused.
 */
export const initialGrantDuration = (
  requestedSeconds: number | null | undefined,
  allowUntilRevoked: boolean,
  fallbackSeconds?: number | null
): GrantDuration => {
  if (typeof requestedSeconds !== 'number' || requestedSeconds <= 0) {
    if (typeof fallbackSeconds === 'number' && fallbackSeconds > 0) {
      const { amount, unit } = splitDuration(fallbackSeconds)
      const standard = DURATION_CHOICES.find((choice) => choice.seconds === fallbackSeconds)
      return { choice: standard ? standard.value : 'custom', amount: String(amount), unit }
    }
    return {
      choice: allowUntilRevoked ? 'forever' : '1h',
      amount: '1',
      unit: 'hours',
    }
  }
  const { amount, unit } = splitDuration(requestedSeconds)
  const standard = DURATION_CHOICES.find((choice) => choice.seconds === requestedSeconds)
  return {
    choice: standard ? standard.value : 'requested',
    amount: String(amount),
    unit,
  }
}

/** The seconds a custom amount and unit stand for, or null when it is not a whole number. */
export const customSeconds = (amount: string, unit: DurationUnit): number | null => {
  if (!/^\d{1,9}$/.test(amount.trim())) return null
  const size = DURATION_UNITS.find((candidate) => candidate.value === unit)?.seconds ?? 60
  return Number(amount.trim()) * size
}

export type GrantDurationResult = {
  /** The mutation arguments: a duration, or until revoked. */
  args: { durationSeconds: number } | { untilRevoked: true } | null
  seconds: number | null
  problem: string
}

/**
 * What the approver's choice sends. `maximumSeconds` caps only allow requests; other grants
 * take any duration within the backend's bounds.
 */
export const grantDurationResult = (
  value: GrantDuration,
  requestedSeconds: number | null | undefined,
  options: { allowUntilRevoked: boolean; maximumSeconds?: number | null }
): GrantDurationResult => {
  if (value.choice === 'forever') {
    if (!options.allowUntilRevoked)
      return { args: null, seconds: null, problem: 'This access always ends.' }
    return { args: { untilRevoked: true }, seconds: null, problem: '' }
  }
  let seconds: number | null = null
  if (value.choice === 'requested') seconds = requestedSeconds ?? null
  else if (value.choice === 'custom') seconds = customSeconds(value.amount, value.unit)
  else seconds = DURATION_CHOICES.find((choice) => choice.value === value.choice)?.seconds ?? null
  if (seconds === null)
    return { args: null, seconds: null, problem: 'Enter a whole number for the duration.' }
  if (seconds < MIN_DURATION_SECONDS)
    return {
      args: null,
      seconds,
      problem: `Access lasts at least ${describeDuration(MIN_DURATION_SECONDS)}.`,
    }
  if (seconds > MAX_GRANTED_SECONDS)
    return {
      args: null,
      seconds,
      problem: `Access lasts at most ${describeDuration(MAX_GRANTED_SECONDS)}. Choose until revoked for longer.`,
    }
  if (options.maximumSeconds && seconds > options.maximumSeconds)
    return {
      args: null,
      seconds,
      problem: `Your organisation allows at most ${describeDuration(options.maximumSeconds)} here.`,
    }
  return { args: { durationSeconds: seconds }, seconds, problem: '' }
}

// --- The organisation setting --------------------------------------------

export type DurationBounds = { min: number; max: number }

/** Why the maximum and default an Agent may ask for cannot be saved, or ''. */
export const settingsProblem = (
  maximum: number | null,
  fallback: number | null,
  bounds: DurationBounds
): string => {
  if (maximum === null || fallback === null) return 'Enter a whole number for each duration.'
  const range = `${describeDuration(bounds.min)} to ${describeDuration(bounds.max)}`
  if (maximum < bounds.min || maximum > bounds.max) return `The maximum must be ${range}.`
  if (fallback < bounds.min || fallback > bounds.max) return `The default must be ${range}.`
  if (fallback > maximum) return 'The default cannot be longer than the maximum.'
  return ''
}
