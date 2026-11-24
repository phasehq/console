/**
 * A line-based diff of two texts, for a reviewer. The result is plain data:
 * callers render each line as text, never as HTML.
 */

export type DiffLine = { type: 'same' | 'add' | 'remove'; text: string }

/** Above this many cells the middle is shown as one removal and one addition. */
const MAX_CELLS = 4_000_000

const lines = (text: string): string[] =>
  text === '' ? [] : text.replace(/\r\n?/g, '\n').split('\n')

export const diffLines = (before: string, after: string): DiffLine[] => {
  const left = lines(before)
  const right = lines(after)

  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1
  let leftEnd = left.length
  let rightEnd = right.length
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd -= 1
    rightEnd -= 1
  }

  const head: DiffLine[] = left.slice(0, start).map((text) => ({ type: 'same', text }))
  const tail: DiffLine[] = left.slice(leftEnd).map((text) => ({ type: 'same', text }))
  const a = left.slice(start, leftEnd)
  const b = right.slice(start, rightEnd)

  let middle: DiffLine[]
  if (a.length * b.length > MAX_CELLS) {
    middle = [
      ...a.map((text): DiffLine => ({ type: 'remove', text })),
      ...b.map((text): DiffLine => ({ type: 'add', text })),
    ]
  } else {
    // Longest common subsequence, filled from the end so the walk runs forward.
    const width = b.length + 1
    const table = new Uint32Array((a.length + 1) * width)
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        table[i * width + j] =
          a[i] === b[j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
      }
    }
    middle = []
    let i = 0
    let j = 0
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        middle.push({ type: 'same', text: a[i] })
        i += 1
        j += 1
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
        middle.push({ type: 'remove', text: a[i] })
        i += 1
      } else {
        middle.push({ type: 'add', text: b[j] })
        j += 1
      }
    }
    for (; i < a.length; i += 1) middle.push({ type: 'remove', text: a[i] })
    for (; j < b.length; j += 1) middle.push({ type: 'add', text: b[j] })
  }
  return [...head, ...middle, ...tail]
}

/** Counts of added and removed lines, for a one-line summary. */
export const diffStats = (diff: DiffLine[]) => ({
  added: diff.filter((line) => line.type === 'add').length,
  removed: diff.filter((line) => line.type === 'remove').length,
})
