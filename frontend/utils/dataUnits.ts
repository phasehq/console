/**
 * Format bytes as human-readable text.
 *
 * @param bytes Number of bytes.
 * @param si True to use metric (SI) units, aka powers of 1000. False to use
 *           binary (IEC), aka powers of 1024.
 * @param dp Number of decimal places to display.
 *
 * @return Formatted string.
 */
export const humanFileSize = (bytes: number, si = false, dp = 1) => {
  const thresh = si ? 1000 : 1024

  if (Math.abs(bytes) < thresh) {
    return bytes + ' B'
  }

  const units = si
    ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB']
  let u = -1
  const r = 10 ** dp

  do {
    bytes /= thresh
    ++u
  } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1)

  return bytes.toFixed(dp) + ' ' + units[u]
}

/**
 * Formats a number with commas.
 *
 * @param {number} num - The number to format.
 * @returns {string} The formatted number string.
 */
export const humanReadableNumber = (num: number): string => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Calculate the percentage based on a given value and maximum value.
 * @param {number} value - The value to calculate the percentage for.
 * @param {number} maxValue - The maximum value to be considered for percentage calculation.
 * @returns {number} The calculated percentage.
 */
export const calculatePercentage = (value: number, maxValue: number): number => {
  // Ensure maxValue is positive, otherwise return 0
  if (maxValue <= 0) {
    return 0
  }

  // Ensure value is non-negative
  const nonNegativeValue = Math.max(value, 0)

  // Calculate the percentage
  return Math.min((nonNegativeValue / maxValue) * 100, 100)
}
