import { OrganisationMemberInviteType } from '@/apollo/graphql'

const units: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 31536000000 },
  { unit: 'month', ms: 2628000000 },
  { unit: 'day', ms: 86400000 },
  { unit: 'hour', ms: 3600000 },
  { unit: 'minute', ms: 60000 },
  { unit: 'second', ms: 1000 },
]
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/**
 * Get language-sensitive relative time message from elapsed time.
 * @param elapsed   - the elapsed time in milliseconds
 */
export const relativeTimeFromElapsed = (elapsed: number) => {
  for (const { unit, ms } of units) {
    if (Math.abs(elapsed) >= ms || unit === 'second') {
      return rtf.format(Math.round(elapsed / ms), unit)
    }
  }
  return ''
}

/**
 * Get language-sensitive relative time message from Dates.
 * @param relative  - the relative dateTime, generally is in the past or future
 * @param pivot     - the dateTime of reference, generally is the current time
 */
export const relativeTimeFromDates = (relative: Date | null, pivot: Date = new Date()) => {
  if (!relative) return ''
  const elapsed = relative.getTime() - pivot.getTime()
  return relativeTimeFromElapsed(elapsed)
}

/**
 * Get a Unix timestamp for a future time, specified in days, hours, and minutes.
 *
 * @param {number} [days=0] - The number of days in the future.
 * @param {number} [hours=0] - The number of hours in the future.
 * @param {number} [minutes=0] - The number of minutes in the future.
 * @returns {number} The Unix timestamp for the future time.
 */
export const getUnixTimeStampinFuture = (
  days: number = 0,
  hours: number = 0,
  minutes: number = 0
): number => {
  const millisecondsInADay = 86400000
  const millisecondsInAnHour = 3600000
  const millisecondsInAMinute = 60000

  return (
    Date.now() +
    days * millisecondsInADay +
    hours * millisecondsInAnHour +
    minutes * millisecondsInAMinute
  )
}

/**
 * Converts a datetime string from python to a unix timestamp
 *
 * @param {string} datetime string
 * @returns {number}
 */
export const dateToUnixTimestamp = (dateString: string): number => {
  const dateObj = new Date(dateString)
  return Math.floor(dateObj.getTime())
}

export const inviteIsExpired = (invite: OrganisationMemberInviteType) => {
  return new Date(invite.expiresAt) < new Date()
}

/**
 * Returns a human-readable duration string from a duration in seconds.
 *
 * @param {number} seconds - duration in seconds
 * @returns {string} - human-readable duration (e.g., "1d 2h", "3h 15m", "45m", "30s")
 */
export const humanReadableDuration = (seconds: number): string => {
  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    const remainingHours = hours % 24
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  }

  return `${minutes}m`
}
