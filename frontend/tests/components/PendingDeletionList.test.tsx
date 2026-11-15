import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { PendingDeletion, PendingDeletionList } from '@/components/common/PendingDeletionList'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const pending: PendingDeletion = {
  id: 'app-1',
  name: 'billing',
  deletionScheduledFor: '2026-10-13T12:00:00Z',
  deletionDelayed: false,
  canRestore: true,
}

describe('PendingDeletionList', () => {
  let container: HTMLDivElement
  let root: Root
  const onRestore = jest.fn()

  const render = async (items: PendingDeletion[], allowRestore = true, restoringId?: string) => {
    await act(async () => {
      root.render(
        <PendingDeletionList
          description="Kept for 24 hours"
          items={items}
          allowRestore={allowRestore}
          restoringId={restoringId}
          onRestore={onRestore}
        />
      )
    })
  }

  const restoreButton = () =>
    Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Restore')
    )

  beforeEach(() => {
    onRestore.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('renders nothing when nothing is scheduled for deletion', async () => {
    await render([])

    expect(container.textContent).toBe('')
  })

  it('shows what is scheduled for deletion and when', async () => {
    await render([pending])

    expect(container.textContent).toContain('Scheduled for deletion')
    expect(container.textContent).toContain('billing')
    expect(container.textContent).toContain('Will be deleted on')
  })

  it('restores the item that was clicked', async () => {
    await render([pending, { ...pending, id: 'app-2', name: 'payments' }])

    await act(async () => restoreButton()!.click())

    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(onRestore).toHaveBeenCalledWith(pending)
  })

  it('offers no restore without the permission to delete', async () => {
    await render([pending], false)

    expect(container.textContent).toContain('Will be deleted on')
    expect(restoreButton()).toBeUndefined()
  })

  it('offers no restore once the grace period has ended', async () => {
    await render([{ ...pending, canRestore: false }])

    expect(container.textContent).toContain('Being deleted')
    expect(container.textContent).not.toContain('Will be deleted on')
    expect(restoreButton()).toBeUndefined()
  })

  it('says the deletion is delayed, and still offers a restore', async () => {
    await render([{ ...pending, deletionDelayed: true }])

    expect(container.textContent).toContain('Deletion delayed')
    expect(container.textContent).not.toContain('Will be deleted on')
    expect(restoreButton()).toBeDefined()
  })

  it('blocks a second restore while one is in flight', async () => {
    await render([pending, { ...pending, id: 'app-2', name: 'payments' }], true, 'app-1')

    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons).toHaveLength(2)
    buttons.forEach((button) => expect(button.disabled).toBe(true))
  })
})
