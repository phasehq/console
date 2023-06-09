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
