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
  return Date.now() + days * 86400000 + hours * 3600000 + minutes * 60000
}
