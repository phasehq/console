import { humanFileSize, humanReadableNumber, calculatePercentage } from '@/utils/dataUnits'

describe('humanFileSize', () => {
  it('should format bytes as human-readable text with metric units by default', () => {
    expect(humanFileSize(0)).toBe('0 B')
    expect(humanFileSize(1024)).toBe('1 KiB')
    expect(humanFileSize(1024 * 1024)).toBe('1 MiB')
    expect(humanFileSize(1024 * 1024 * 1024)).toBe('1 GiB')
    expect(humanFileSize(1024 * 1024 * 1024 * 1024)).toBe('1 TiB')
  })

  it('should format bytes as human-readable text with binary units when specified', () => {
    expect(humanFileSize(0, true)).toBe('0 B')
    expect(humanFileSize(1024, true)).toBe('1 kB')
    expect(humanFileSize(1024 * 1024, true)).toBe('1 MB')
    expect(humanFileSize(1024 * 1024 * 1024, true)).toBe('1 GB')
    expect(humanFileSize(1024 * 1024 * 1024 * 1024, true)).toBe('1 TB')
  })

  it('should format bytes as human-readable text with custom decimal places', () => {
    expect(humanFileSize(0, false, 3)).toBe('0 B')
    expect(humanFileSize(1024, false, 3)).toBe('1.000 KiB')
    expect(humanFileSize(1024 * 1024 + 1, false, 3)).toBe('1.000 MiB')
    expect(humanFileSize(1024 * 1024 * 1024 - 1, false, 3)).toBe('1.000 GiB')
    expect(humanFileSize(1024 * 1024 * 1024, false, 3)).toBe('1.000 GiB')
    expect(humanFileSize(1024 * 1024 * 1024 + 1, false, 3)).toBe('1.000 GiB')
    expect(humanFileSize(1024 * 1024 * 1024 * 1024 - 1, false, 3)).toBe('1.000 TiB')
    expect(humanFileSize(1024 * 1024 * 1024 * 1024, false, 3)).toBe('1.000 TiB')
    expect(humanFileSize(1024 * 1024 * 1024 * 1024 + 1, false, 3)).toBe('1.000 TiB')
  })
})

describe('humanReadableNumber', () => {
  it('should format numbers with commas', () => {
    expect(humanReadableNumber(1234)).toBe('1,234')
    expect(humanReadableNumber(123456789)).toBe('123,456,789')
  })
})

describe('calculatePercentage', () => {
  it('should calculate the percentage based on a given value and maximum value', () => {
    expect(calculatePercentage(10, 10)).toBe(100)
    expect(calculatePercentage(5, 10)).toBe(50)
    expect(calculatePercentage(-5, 10)).toBe(0)
  })
})
