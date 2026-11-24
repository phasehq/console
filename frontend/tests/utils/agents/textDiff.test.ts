import { diffLines, diffStats } from '@/utils/agents/textDiff'

describe('line diff', () => {
  test('identical text has no changes', () => {
    const diff = diffLines('a\nb', 'a\nb')
    expect(diff.every((line) => line.type === 'same')).toBe(true)
    expect(diffStats(diff)).toEqual({ added: 0, removed: 0 })
  })

  test('shows an added, a removed and a changed line in place', () => {
    const diff = diffLines('one\ntwo\nthree', 'one\n2\nthree\nfour')
    expect(diff).toEqual([
      { type: 'same', text: 'one' },
      { type: 'remove', text: 'two' },
      { type: 'add', text: '2' },
      { type: 'same', text: 'three' },
      { type: 'add', text: 'four' },
    ])
    expect(diffStats(diff)).toEqual({ added: 2, removed: 1 })
  })

  test('an empty side is all additions or all removals', () => {
    expect(diffLines('', 'a\nb')).toEqual([
      { type: 'add', text: 'a' },
      { type: 'add', text: 'b' },
    ])
    expect(diffLines('a', '')).toEqual([{ type: 'remove', text: 'a' }])
    expect(diffLines('', '')).toEqual([])
  })

  test('treats Windows line endings as line breaks', () => {
    expect(diffLines('a\r\nb', 'a\nb').every((line) => line.type === 'same')).toBe(true)
  })

  test('keeps markup as text, untouched', () => {
    const text = '<img src=x onerror=alert(1)>'
    expect(diffLines('', text)).toEqual([{ type: 'add', text }])
  })

  test('keeps matching lines through many changes', () => {
    const before = Array.from({ length: 1500 }, (_, index) => `line ${index}`).join('\n')
    const after = Array.from({ length: 1500 }, (_, index) =>
      index % 2 ? `line ${index}` : `changed ${index}`
    ).join('\n')
    const stats = diffStats(diffLines(before, after))
    expect(stats).toEqual({ added: 750, removed: 750 })
  })

  test('a very large rewrite is shown as one removal and one addition, without stalling', () => {
    const before = Array.from({ length: 4000 }, (_, index) => `a ${index}`).join('\n')
    const after = Array.from({ length: 4000 }, (_, index) => `b ${index}`).join('\n')
    expect(diffStats(diffLines(before, after))).toEqual({ added: 4000, removed: 4000 })
  })
})
