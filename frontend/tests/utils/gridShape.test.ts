import {
  GRID_SHAPE_ROWS,
  defaultGridShape,
  parseGridShape,
} from '@/app/[team]/apps/[app]/_components/gridShape'

const stored = {
  envs: [
    { id: 'env-1', color: '#22c55e', nameChars: 11 },
    { id: 'env-2', color: '#eab308', nameChars: 7 },
  ],
  longestKeyChars: 25,
  longestFolderChars: 7,
  maxRowDepth: 0,
  maxTagCount: 1,
  maxRowNumber: 17,
  trailingRem: 10.5,
  rows: 'ffgdddgrrrsss',
}

describe('parseGridShape', () => {
  it('reads back what was stored', () => {
    expect(parseGridShape(JSON.parse(JSON.stringify(stored)))).toEqual(stored)
  })

  it('turns away anything that is not a shape', () => {
    expect(parseGridShape(null)).toBeNull()
    expect(parseGridShape('ffss')).toBeNull()
    expect(parseGridShape({ ...stored, envs: 'two' })).toBeNull()
    expect(parseGridShape({ ...stored, envs: [] })).toBeNull()
    expect(parseGridShape({ ...stored, rows: 12 })).toBeNull()
  })

  it('turns away rows that are not row kinds', () => {
    expect(parseGridShape({ ...stored, rows: 'ffx' })).toBeNull()
    expect(parseGridShape({ ...stored, rows: '<td>' })).toBeNull()
  })

  it('keeps an empty grid: columns with no rows', () => {
    expect(parseGridShape({ ...stored, rows: '' })?.rows).toBe('')
  })

  it('drops a colour that is not a plain hex, keeping the column', () => {
    const shape = parseGridShape({
      ...stored,
      envs: [{ id: 'env-1', color: 'red; background: url(x)', nameChars: 4 }],
    })
    expect(shape?.envs).toEqual([{ id: 'env-1', color: '', nameChars: 4 }])
  })

  it('keeps the mark of a column that is scheduled for deletion, and only that mark', () => {
    const shape = parseGridShape({
      ...stored,
      envs: [
        { ...stored.envs[0], deleted: true },
        { ...stored.envs[1], deleted: 'yes' },
      ],
    })
    expect(shape?.envs).toEqual([{ ...stored.envs[0], deleted: true }, stored.envs[1]])
  })

  it('skips env entries without an id', () => {
    const shape = parseGridShape({ ...stored, envs: [null, { color: '#fff' }, stored.envs[0]] })
    expect(shape?.envs).toEqual([stored.envs[0]])
  })

  it('holds sizes within bounds', () => {
    const shape = parseGridShape({
      ...stored,
      longestKeyChars: 1e9,
      maxRowDepth: -3,
      maxTagCount: 'many',
      trailingRem: Infinity,
      rows: 's'.repeat(GRID_SHAPE_ROWS + 40),
    })
    expect(shape?.longestKeyChars).toBe(256)
    expect(shape?.maxRowDepth).toBe(0)
    expect(shape?.maxTagCount).toBe(0)
    expect(shape?.trailingRem).toBe(0)
    expect(shape?.rows).toHaveLength(GRID_SHAPE_ROWS)
  })
})

describe('defaultGridShape', () => {
  it('is a shape the parser accepts', () => {
    const shape = defaultGridShape(2.75)
    expect(parseGridShape(JSON.parse(JSON.stringify(shape)))).toEqual(shape)
  })

  it('carries the trailing column it was given', () => {
    expect(defaultGridShape(10.5).trailingRem).toBe(10.5)
  })
})
