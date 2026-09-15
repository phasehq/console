import { AsyncDraftGuard } from '@/utils/asyncDraftGuard'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('a background decryption finishing after Add preserves the draft and typed values', async () => {
  const guard = new AsyncDraftGuard()
  let rows = ['saved row']
  const response = deferred<string[]>()
  const ticket = guard.begin()
  const pending = response.promise.then((snapshot) =>
    guard.apply(ticket, () => {
      rows = snapshot
    })
  )
  guard.edited()
  rows = ['provider draft with a typed value', ...rows]
  response.resolve(['saved row from an earlier poll'])
  expect(await pending).toBe(false)
  expect(rows).toEqual(['provider draft with a typed value', 'saved row'])
})

test('a refetch that starts after editing still preserves all unsaved rows', () => {
  const guard = new AsyncDraftGuard()
  guard.edited()
  const update = jest.fn()
  expect(guard.apply(guard.begin(), update)).toBe(false)
  expect(update).not.toHaveBeenCalled()
})

test('successful Deploy permits the confirmed snapshot while invalidating old decryptions', () => {
  const guard = new AsyncDraftGuard()
  guard.edited()
  const submitted = guard.currentRevision()
  const beforeSave = guard.begin()
  guard.saved(submitted)
  guard.observeDirty(true) // React has not replaced the temporary rows yet.
  const update = jest.fn()
  expect(guard.apply(beforeSave, update)).toBe(false)
  expect(guard.apply(guard.begin(), update)).toBe(true)
  expect(update).toHaveBeenCalledTimes(1)
})

test('editing after a submitted save cannot be overwritten by that save response', () => {
  const guard = new AsyncDraftGuard()
  guard.edited()
  const submitted = guard.currentRevision()
  guard.edited()
  guard.saved(submitted)
  expect(guard.apply(guard.begin(), jest.fn())).toBe(false)
})

test('only the newest active decryption can apply, and unmounted work is cancelled', () => {
  const guard = new AsyncDraftGuard()
  const old = guard.begin()
  const current = guard.begin()
  const update = jest.fn()
  expect(guard.apply(old, update)).toBe(false)
  guard.cancel(current)
  expect(guard.apply(current, update)).toBe(false)
  expect(update).not.toHaveBeenCalled()
})

test('discarding edits restores normal polling without reviving older work', () => {
  const guard = new AsyncDraftGuard()
  const old = guard.begin()
  guard.edited()
  guard.observeDirty(false)
  expect(guard.apply(old, jest.fn())).toBe(false)
  expect(guard.apply(guard.begin(), jest.fn())).toBe(true)
})
