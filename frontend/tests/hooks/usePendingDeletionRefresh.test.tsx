import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { PendingDeletion } from '@/components/common/PendingDeletionList'
import { usePendingDeletionRefresh } from '@/hooks/usePendingDeletionRefresh'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date('2026-10-12T12:00:00Z').getTime()
const HOUR = 60 * 60 * 1000

const item = (overrides: Partial<PendingDeletion> = {}): PendingDeletion => ({
  id: 'app-1',
  name: 'billing',
  deletionScheduledFor: new Date(NOW + 3 * HOUR).toISOString(),
  deletionDelayed: false,
  canRestore: true,
  ...overrides,
})

describe('usePendingDeletionRefresh', () => {
  let container: HTMLDivElement
  let root: Root
  const refetch = jest.fn()
  const startPolling = jest.fn()
  const stopPolling = jest.fn()

  const Probe = ({ items }: { items: PendingDeletion[] }) => {
    usePendingDeletionRefresh(items, { refetch, startPolling, stopPolling })
    return null
  }

  const render = async (items: PendingDeletion[]) => {
    await act(async () => root.render(<Probe items={items} />))
  }

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(NOW)
    jest.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.useRealTimers()
  })

  it('asks again when the next deadline passes, not before', async () => {
    await render([
      item({ id: 'later', deletionScheduledFor: new Date(NOW + 5 * HOUR).toISOString() }),
      item({ id: 'sooner' }),
    ])

    expect(startPolling).not.toHaveBeenCalled()
    await act(async () => jest.advanceTimersByTime(3 * HOUR - 1000))
    expect(refetch).not.toHaveBeenCalled()

    await act(async () => jest.advanceTimersByTime(2500))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('moves on to the deadline after that', async () => {
    const later = item({
      id: 'later',
      deletionScheduledFor: new Date(NOW + 5 * HOUR).toISOString(),
    })
    await render([later, item({ id: 'sooner' })])
    await act(async () => jest.advanceTimersByTime(3 * HOUR + 1500))

    // The server now says the first one can no longer be restored.
    await render([later, item({ id: 'sooner', canRestore: false })])
    refetch.mockClear()

    await act(async () => jest.advanceTimersByTime(2 * HOUR + 1500))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('keeps asking when its clock runs ahead of the server', async () => {
    await render([item()])
    await act(async () => jest.advanceTimersByTime(3 * HOUR + 1500))

    // Asked once, and the server still calls the item restorable.
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(startPolling).toHaveBeenCalledWith(60000)
  })

  it('polls quickly while an item is being deleted', async () => {
    await render([item({ canRestore: false })])

    expect(startPolling).toHaveBeenCalledWith(5000)
    await act(async () => jest.advanceTimersByTime(24 * HOUR))
    // No deadline to wait for: the poll is what refreshes the list.
    expect(refetch).not.toHaveBeenCalled()
  })

  it('polls slowly while a deletion is delayed, so a retry that succeeds shows', async () => {
    await render([item({ deletionDelayed: true })])

    expect(startPolling).toHaveBeenCalledWith(60000)
    // Past its time already: there is no deadline to refetch at.
    await act(async () => jest.advanceTimersByTime(24 * HOUR))
    expect(refetch).not.toHaveBeenCalled()
  })

  it('stops polling once nothing is being deleted or delayed', async () => {
    await render([item({ canRestore: false })])
    await render([])

    expect(stopPolling).toHaveBeenCalledTimes(1)
  })

  it('does nothing for an empty list', async () => {
    await render([])
    await act(async () => jest.advanceTimersByTime(24 * HOUR))

    expect(startPolling).not.toHaveBeenCalled()
    expect(refetch).not.toHaveBeenCalled()
  })
})
