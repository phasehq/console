import { gridLayout, rowGutterRem } from '@/app/[team]/apps/[app]/_components/gridColumns'

const base = {
  slimCount: 0,
  viewportWidth: 1440,
  rootFontPx: 16,
  longestKeyChars: 12,
  longestFolderChars: 0,
  maxRowDepth: 0,
  maxTagCount: 0,
  // Not a real gutter width (those are multiples of 0.45): it keeps the widths below round
  gutterRem: 1.5,
  customWidthsPx: [] as number[],
  trailingRem: 2.75,
}

describe('gridLayout', () => {
  it('keeps the single-env proportions with one env checked', () => {
    const layout = gridLayout({ ...base, checkedCount: 1 })
    expect(layout.keyColumnWidth).toBe('33.333%')
    // The key's third still holds its hover menu: 3 × 16.875rem
    expect(layout.tableMinWidth).toBe('51rem')
  })

  it('fits the key column to the longest key with several envs checked', () => {
    // 3.75rem chrome + 1.5rem gutter + 40 chars × 0.75rem × 0.625 = 24rem = 384px
    const layout = gridLayout({ ...base, checkedCount: 3, longestKeyChars: 40 })
    expect(layout.keyColumnWidth).toBe('384px')
    // From xl up every env column keeps 28rem for its labelled value menu, plus the trailing column
    expect(layout.tableMinWidth).toBe('calc(384px + 86.75rem)')
  })

  it('narrows env columns to the icon-only value menu below xl', () => {
    const layout = gridLayout({ ...base, checkedCount: 3, viewportWidth: 1200 })
    expect(layout.tableMinWidth).toBe('calc(272px + 61.25rem)')
  })

  it("never goes below the width the key's hover menu needs", () => {
    // 1.625rem inset + 1.5rem gutter + 13.75rem menu = 270px → 272px
    expect(gridLayout({ ...base, checkedCount: 4, longestKeyChars: 4 }).keyColumnWidth).toBe('272px')
    // Wider at 2xl, where Tags and Comment show their labels
    expect(
      gridLayout({ ...base, checkedCount: 4, longestKeyChars: 4, viewportWidth: 1600 }).keyColumnWidth
    ).toBe('368px')
  })

  it("widens for the shown rows' tag dots and folder indent", () => {
    // + 0.25rem + 4 dots × 0.5625rem + 2 levels × 1rem = 21.375rem = 342px → 344px
    expect(
      gridLayout({ ...base, checkedCount: 3, maxTagCount: 4, maxRowDepth: 2 }).keyColumnWidth
    ).toBe('344px')
    // More than four tags add a "+N" instead of more dots
    expect(gridLayout({ ...base, checkedCount: 3, maxTagCount: 9 }).keyColumnWidth).toBe('328px')
  })

  it('lets the menu floor win over the 40% cap on desktop, but not on phones', () => {
    const deep = { ...base, checkedCount: 3, maxTagCount: 6, maxRowDepth: 3 }
    // 23.125rem = 370px, over 40% of 700px
    expect(gridLayout({ ...deep, viewportWidth: 700 }).keyColumnWidth).toBe('376px')
    expect(gridLayout({ ...deep, viewportWidth: 390 }).keyColumnWidth).toBe('160px')
  })

  it('caps very long keys at 30rem or 40% of the viewport', () => {
    expect(gridLayout({ ...base, checkedCount: 3, longestKeyChars: 200 }).keyColumnWidth).toBe('480px')
    expect(
      gridLayout({ ...base, checkedCount: 3, longestKeyChars: 200, viewportWidth: 1000 })
        .keyColumnWidth
    ).toBe('400px')
  })

  it('lets a long folder name widen the column', () => {
    // 3.25rem chrome + 32 chars × 0.75rem × 0.6 = 17.65rem ≈ 282px → 288px in 8px steps
    expect(
      gridLayout({ ...base, checkedCount: 2, longestKeyChars: 8, longestFolderChars: 32 })
        .keyColumnWidth
    ).toBe('288px')
  })

  it('sizes from content on phones too, even with one env checked', () => {
    const layout = gridLayout({ ...base, checkedCount: 1, viewportWidth: 390 })
    expect(layout.keyColumnWidth).toBe('160px')
    expect(layout.tableMinWidth).toBe('calc(160px + 22.25rem)')
  })

  it('keeps user-set env widths and lets the other envs share the rest', () => {
    const layout = gridLayout({ ...base, checkedCount: 3, longestKeyChars: 40, customWidthsPx: [600] })
    // 384px key + 600px + 2 × 28rem + 2.75rem trailing; the auto columns still stretch
    expect(layout.tableMinWidth).toBe('calc(984px + 58.75rem)')
    expect(layout.tableWidth).toBe('100%')
  })

  it('sizes the table to its columns when every checked env has a width', () => {
    const layout = gridLayout({
      ...base,
      checkedCount: 2,
      longestKeyChars: 40,
      customWidthsPx: [500, 520],
    })
    expect(layout.tableMinWidth).toBe('calc(1404px + 2.75rem)')
    expect(layout.tableWidth).toBe(layout.tableMinWidth)
  })

  it('lets user widths go below the defaults, down to 80px', () => {
    expect(
      gridLayout({ ...base, checkedCount: 2, longestKeyChars: 40, customWidthsPx: [100, 40] })
        .tableMinWidth
    ).toBe('calc(564px + 2.75rem)')
  })

  it('fills the grid with a single env until its column is dragged', () => {
    const filling = gridLayout({ ...base, checkedCount: 1 })
    expect(filling.tableWidth).toBe('100%')
    expect(filling.keyColumnInset).toBe('33.333%')

    // Dragged, the table stops at its columns. The key keeps the width it had: a third of the
    // grid, or of the table's 51rem minimum where the grid is narrower
    const dragged = gridLayout({ ...base, checkedCount: 1, customWidthsPx: [700] })
    expect(dragged.keyColumnWidth).toBe('max(33.333cqw, 17rem)')
    expect(dragged.tableWidth).toBe('calc(max(33.333cqw, 17rem) + 700px + 2.75rem)')
    expect(dragged.tableMinWidth).toBe(dragged.tableWidth)
    // The scroller can't measure itself in cqw: its scroll padding reads the same third as a percentage
    expect(dragged.keyColumnInset).toBe('max(33.333%, 17rem)')
  })

  it("counts the hidden envs' slim columns in a dragged single env's table", () => {
    const layout = gridLayout({ ...base, checkedCount: 1, slimCount: 2, customWidthsPx: [700] })
    // 2 × 2.25rem slim + 2.75rem trailing; the minimum's third grows with them (53rem / 3)
    expect(layout.tableWidth).toBe('calc(max(33.333cqw, 17.667rem) + 700px + 7.25rem)')
  })

  it('uses a user-set key width in place of the fitted one', () => {
    const layout = gridLayout({ ...base, checkedCount: 3, longestKeyChars: 40, customKeyPx: 150 })
    expect(layout.keyColumnWidth).toBe('150px')
    expect(layout.tableMinWidth).toBe('calc(150px + 86.75rem)')
    // ...and in place of the single-env ⅓
    const single = gridLayout({ ...base, checkedCount: 1, customKeyPx: 150 })
    expect(single.keyColumnWidth).toBe('150px')
    expect(single.tableMinWidth).toBe('calc(150px + 30.75rem)')
    // ...and beside a dragged single env, where both widths are the user's
    const both = gridLayout({ ...base, checkedCount: 1, customKeyPx: 150, customWidthsPx: [700] })
    expect(both.keyColumnWidth).toBe('150px')
    expect(both.tableWidth).toBe('calc(150px + 700px + 2.75rem)')
  })

  it('makes room for the new-environment column', () => {
    const layout = gridLayout({ ...base, checkedCount: 3, longestKeyChars: 40, trailingRem: 10.5 })
    expect(layout.tableMinWidth).toBe('calc(384px + 94.5rem)')
  })

  it('reserves room for slim (hidden) env columns', () => {
    const layout = gridLayout({ ...base, checkedCount: 2, slimCount: 2, longestKeyChars: 40 })
    // 2 × 28rem + 2 × 2.25rem slim + 2.75rem trailing
    expect(layout.tableMinWidth).toBe('calc(384px + 63.25rem)')
  })
})

describe('rowGutterRem', () => {
  it('fits the longest row number shown, at 0.45rem a digit', () => {
    expect(rowGutterRem(100)).toBeCloseTo(1.35)
    expect(rowGutterRem(9999)).toBeCloseTo(1.8)
    expect(rowGutterRem(12345)).toBeCloseTo(2.25)
  })

  it('is never narrower than two digits, which is what the checkbox needs', () => {
    expect(rowGutterRem(0)).toBeCloseTo(0.9)
    expect(rowGutterRem(7)).toBeCloseTo(0.9)
    expect(rowGutterRem(99)).toBeCloseTo(0.9)
  })

  it('carries into the key column width', () => {
    const keys = { ...base, checkedCount: 3, longestKeyChars: 40 }
    // 3.75rem chrome + 18.75rem key + 0.9rem = 374.4px → 376px; + 2.25rem = 396px → 400px
    expect(gridLayout({ ...keys, gutterRem: rowGutterRem(12) }).keyColumnWidth).toBe('376px')
    expect(gridLayout({ ...keys, gutterRem: rowGutterRem(12345) }).keyColumnWidth).toBe('400px')
  })
})
