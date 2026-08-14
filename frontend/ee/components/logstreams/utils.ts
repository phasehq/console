export type LogStreamOptions = {
  service?: string
  tags?: string
  gzip?: boolean
}

/**
 * Graphene serializes JSONField via the JSONString scalar — the client
 * receives a JSON-encoded *string*, not an object. Reading properties off it
 * directly silently yields undefined (and would reset stored options on the
 * next save).
 */
export const parseStreamOptions = (raw: unknown): LogStreamOptions => {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }
  return (raw as LogStreamOptions) ?? {}
}

/**
 * Human-readable cursor lag: "Up to date", "26 minutes behind", "3 days behind".
 * The operator's backpressure signal for a log stream source.
 */
export const humanizeLag = (lagSeconds: number): string => {
  if (lagSeconds < 60) return 'Up to date'

  const units: [number, string][] = [
    [7 * 24 * 3600, 'week'],
    [24 * 3600, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ]

  for (const [seconds, label] of units) {
    if (lagSeconds >= seconds) {
      const value = Math.floor(lagSeconds / seconds)
      return `${value} ${label}${value === 1 ? '' : 's'} behind`
    }
  }

  return 'Up to date'
}

export const lagIsCritical = (lagSeconds: number, maxEventAgeHours?: number | null): boolean => {
  if (!maxEventAgeHours) return false
  // Within 2h of the destination's max event age, the backlog is at risk of
  // being skipped.
  return lagSeconds > (maxEventAgeHours - 2) * 3600
}

// lagSeconds is the age of the oldest event still waiting to ship (delivery
// delay), so a sustained value above this means deliveries genuinely aren't
// keeping up — surfaced as the neutral "Delayed" status.
const DELAY_THRESHOLD_SECONDS = 300

export const worstLag = (stream: {
  sourceLags?: ({ lagSeconds: number } | null)[] | null
}): number => Math.max(0, ...(stream.sourceLags?.map((lag) => lag?.lagSeconds ?? 0) ?? [0]))

export const streamIsDelayed = (stream: {
  isActive: boolean
  sourceLags?: ({ lagSeconds: number } | null)[] | null
}): boolean => stream.isActive && worstLag(stream) > DELAY_THRESHOLD_SECONDS
