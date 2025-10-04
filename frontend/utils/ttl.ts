// TTL conversion utilities for human-readable time formats

export interface ParsedTTL {
  value: number
  unit: 's' | 'm' | 'h' | 'd'
  seconds: number
}

/**
 * Parse a human-readable TTL string into seconds
 * Supports: 60s (seconds), 10m (minutes), 100h (hours), 365d (days)
 */
export function parseTTL(ttlString: string): number {
  const trimmed = ttlString.trim()
  if (!trimmed) return 0

  // If it's just a number, assume seconds
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10)
  }

  const match = trimmed.match(/^(\d+)([smhd])$/i)
  if (!match) {
    // If invalid format, try to parse as number
    const num = parseInt(trimmed, 10)
    return isNaN(num) ? 0 : num
  }

  const value = parseInt(match[1], 10)
  const unit = match[2].toLowerCase() as 's' | 'm' | 'h' | 'd'

  switch (unit) {
    case 's':
      return value
    case 'm':
      return value * 60
    case 'h':
      return value * 60 * 60
    case 'd':
      return value * 24 * 60 * 60
    default:
      return value
  }
}

/**
 * Format seconds into a human-readable TTL string
 * Automatically chooses the most appropriate unit
 */
export function formatTTL(seconds: number): string {
  if (seconds === 0) return '0s'

  // Find the largest unit that divides evenly
  if (seconds % (24 * 60 * 60) === 0) {
    return `${seconds / (24 * 60 * 60)}d`
  }
  if (seconds % (60 * 60) === 0) {
    return `${seconds / (60 * 60)}h`
  }
  if (seconds % 60 === 0) {
    return `${seconds / 60}m`
  }
  return `${seconds}s`
}

/**
 * Validate a TTL string format
 */
export function isValidTTL(ttlString: string): boolean {
  const trimmed = ttlString.trim()
  if (!trimmed) return false

  // Just a number is valid (assumes seconds)
  if (/^\d+$/.test(trimmed)) return true

  // Format: number + unit
  return /^\d+[smhd]$/i.test(trimmed)
}

/**
 * Get TTL examples for placeholders
 */
export function getTTLExamples(): string[] {
  return ['60s', '10m', '2h', '7d']
}

export const MINIMUM_LEASE_TTL = 60 // 1 minute

export const leaseTtlButtons = [
  {
    label: '15min',
    seconds: '900',
  },
  {
    label: '1h',
    seconds: '3600',
  },
  {
    label: '12h',
    seconds: '43200',
  },
  {
    label: '24h',
    seconds: '86400',
  },
  {
    label: '30d',
    seconds: '2592000',
  },
  {
    label: '90d',
    seconds: '7776000',
  },
]
