import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { DeletedEnvironmentType } from '@/apollo/graphql'
import { DeletedEnvironmentDialog } from '@/components/environments/DeletedEnvironmentDialog'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
// jsdom has no Web Animations; the dialog's transition asks for them.
Element.prototype.getAnimations = () => []

const staging: DeletedEnvironmentType = {
  id: 'env-2',
  name: 'Staging',
  envType: 'STAGING',
  index: 1,
  deletedAt: '2026-11-22T12:00:00Z',
  deletionScheduledFor: '2026-11-23T12:00:00Z',
  deletionDelayed: false,
  canRestore: true,
}

describe('DeletedEnvironmentDialog', () => {
  let container: HTMLDivElement
  let root: Root
  const onRestore = jest.fn()
  const onDeleteNow = jest.fn(async () => {})
  const onClose = jest.fn()

  const render = (
    environment: DeletedEnvironmentType | null,
    { allowRestore = true, restoring = false } = {}
  ) =>
    act(async () => {
      root.render(
        <DeletedEnvironmentDialog
          environment={environment}
          allowRestore={allowRestore}
          restoring={restoring}
          onRestore={onRestore}
          onDeleteNow={onDeleteNow}
          onClose={onClose}
        />
      )
    })
  const buttons = (label: string) =>
    Array.from(document.body.querySelectorAll('button')).filter(
      (button) => button.textContent?.trim() === label
    )
  const text = () => document.body.textContent ?? ''

  beforeEach(() => {
    onRestore.mockClear()
    onDeleteNow.mockClear()
    onClose.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('is closed without an environment', async () => {
    await render(null)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('says when a scheduled environment goes, and offers the way back', async () => {
    await render(staging)

    expect(text()).toContain('Staging')
    expect(text()).toContain('Will be deleted on ')
    expect(text()).toContain('kept for 24 hours, then permanently deleted')
    expect(buttons('Delete now')).toHaveLength(1)

    await act(async () => buttons('Restore')[0].click())
    expect(onRestore).toHaveBeenCalledWith(staging)
  })

  it('asks before deleting now, then deletes that environment', async () => {
    await render(staging)

    await act(async () => buttons('Delete now')[0].click())
    expect(text()).toContain('This Environment will be deleted immediately')
    expect(onDeleteNow).not.toHaveBeenCalled()

    // The confirmation's own button, after the one that opened it
    await act(async () => buttons('Delete now').at(-1)!.click())
    expect(onDeleteNow).toHaveBeenCalledWith(staging)
  })

  it('offers nothing to someone who may not delete environments', async () => {
    await render(staging, { allowRestore: false })

    expect(text()).toContain('Will be deleted on ')
    expect(buttons('Restore')).toHaveLength(0)
    expect(buttons('Delete now')).toHaveLength(0)
  })

  it('offers nothing once the environment is being deleted', async () => {
    await render({ ...staging, canRestore: false })

    expect(text()).toContain('Being deleted')
    expect(text()).toContain('It can no longer be restored')
    expect(buttons('Restore')).toHaveLength(0)
    expect(buttons('Delete now')).toHaveLength(0)
  })

  it('offers only the restore while the deletion is held up', async () => {
    await render({ ...staging, deletionDelayed: true })

    expect(text()).toContain('Deletion delayed')
    expect(text()).toContain('can still be restored')
    expect(buttons('Restore')).toHaveLength(1)
    // It is already past its time: there is nothing to bring forward
    expect(buttons('Delete now')).toHaveLength(0)
  })

  it('holds its actions while a restore is under way', async () => {
    await render(staging, { restoring: true })

    expect((buttons('Delete now')[0] as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps its content while it closes, when the environment has left the list', async () => {
    await render(staging)
    await render(null)

    // Nothing of another environment, and no crash: what is left is the one it showed
    expect(text()).not.toContain('undefined')
  })
})
