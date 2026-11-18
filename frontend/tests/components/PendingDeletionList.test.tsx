import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import {
  isBeingDeleted,
  PendingDeletion,
  PendingDeletionList,
} from '@/components/common/PendingDeletionList'
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
  const onDeleteNow = jest.fn(async () => {})

  const render = async (items: PendingDeletion[], allowRestore = true, restoringId?: string) => {
    await act(async () => {
      root.render(
        <PendingDeletionList
          kind="App"
          description="Kept for 24 hours"
          items={items}
          allowRestore={allowRestore}
          restoringId={restoringId}
          onRestore={onRestore}
          onDeleteNow={onDeleteNow}
        />
      )
    })
  }

  const buttons = (label: string, within: ParentNode = container) =>
    Array.from(within.querySelectorAll('button')).filter(
      (button) => button.textContent?.trim() === label
    )

  const restoreButton = () => buttons('Restore')[0]
  const deleteNowButton = () => buttons('Delete now')[0]

  beforeEach(() => {
    onRestore.mockClear()
    onDeleteNow.mockClear()
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

  it('offers neither restore nor delete now without the permission to delete', async () => {
    await render([pending], false)

    expect(container.textContent).toContain('Will be deleted on')
    expect(restoreButton()).toBeUndefined()
    expect(deleteNowButton()).toBeUndefined()
  })

  it('offers neither once the deletion is under way', async () => {
    await render([{ ...pending, canRestore: false }])

    expect(container.textContent).toContain('Being deleted')
    expect(container.textContent).not.toContain('Will be deleted on')
    expect(restoreButton()).toBeUndefined()
    expect(deleteNowButton()).toBeUndefined()
  })

  it('says the deletion is delayed, and offers a restore but not delete now', async () => {
    await render([{ ...pending, deletionDelayed: true }])

    expect(container.textContent).toContain('Deletion delayed')
    expect(container.textContent).not.toContain('Will be deleted on')
    expect(restoreButton()).toBeDefined()
    // It is already past its time: there is nothing to bring forward.
    expect(deleteNowButton()).toBeUndefined()
  })

  it('blocks a second action while a restore is in flight', async () => {
    await render([pending, { ...pending, id: 'app-2', name: 'payments' }], true, 'app-1')

    const all = Array.from(container.querySelectorAll('button'))
    expect(all).toHaveLength(4)
    all.forEach((button) => expect(button.disabled).toBe(true))
  })

  it('asks before deleting now, and deletes nothing until confirmed', async () => {
    await render([pending])

    await act(async () => deleteNowButton().click())

    // The confirmation opens in a portal, outside the list.
    expect(onDeleteNow).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('This App will be deleted immediately')
    expect(document.body.textContent).toContain('This cannot be undone')

    const confirm = buttons('Delete now', document.body).find(
      (button) => !container.contains(button)
    )
    await act(async () => confirm!.click())

    expect(onDeleteNow).toHaveBeenCalledTimes(1)
    expect(onDeleteNow).toHaveBeenCalledWith(pending)
    expect(onRestore).not.toHaveBeenCalled()
  })

  it('deletes nothing when the confirmation is cancelled', async () => {
    await render([pending])

    await act(async () => deleteNowButton().click())
    await act(async () => buttons('Cancel', document.body)[0].click())

    expect(onDeleteNow).not.toHaveBeenCalled()
  })
})

describe('isBeingDeleted', () => {
  it('is true only once it can no longer be restored and is not delayed', () => {
    expect(isBeingDeleted({ canRestore: false, deletionDelayed: false })).toBe(true)
    expect(isBeingDeleted({ canRestore: true, deletionDelayed: false })).toBe(false)
    expect(isBeingDeleted({ canRestore: true, deletionDelayed: true })).toBe(false)
  })
})
