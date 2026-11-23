import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { DeletedEnvironmentType } from '@/apollo/graphql'
import { DeletedEnvironments } from '@/components/environments/DeletedEnvironments'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const environment = (name: string, canRestore = true) =>
  ({
    id: `env-${name}`,
    name,
    index: 1,
    deletionScheduledFor: '2026-11-24T12:00:00Z',
    deletionDelayed: false,
    canRestore,
  }) as DeletedEnvironmentType

describe('DeletedEnvironments', () => {
  let container: HTMLDivElement
  let root: Root
  const onRestore = jest.fn()
  const onDeleteNow = jest.fn(async () => {})

  const render = (environments: DeletedEnvironmentType[], allowRestore: boolean) =>
    act(async () =>
      root.render(
        <DeletedEnvironments
          environments={environments}
          allowRestore={allowRestore}
          restoringId={null}
          onRestore={onRestore}
          onDeleteNow={onDeleteNow}
        />
      )
    )
  const rows = () => Array.from(container.querySelectorAll('li'))
  const buttons = (row: Element) =>
    Array.from(row.querySelectorAll('button')).map((button) => button.textContent?.trim())

  beforeEach(() => {
    jest.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('lists each environment with when it goes, and says how long they are kept', async () => {
    await render([environment('Staging'), environment('QA', false)], true)

    expect(container.textContent).toContain('Scheduled for deletion')
    expect(container.textContent).toContain('Deleted Environments are kept for 24 hours')
    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^StagingWill be deleted on /),
      // Its spinner has a label of its own
      expect.stringMatching(/^QA.*Being deleted$/),
    ])
  })

  it('lets whoever may delete an environment restore it, or delete it now', async () => {
    const staging = environment('Staging')
    await render([staging, environment('QA', false)], true)

    expect(buttons(rows()[0])).toEqual(['Restore', 'Delete now'])
    // Past restoring: there is nothing left to do with it
    expect(buttons(rows()[1])).toEqual([])

    await act(async () => rows()[0].querySelector('button')!.click())
    expect(onRestore).toHaveBeenCalledWith(staging)
  })

  it('offers neither to someone who may only read environments', async () => {
    await render([environment('Staging')], false)

    expect(rows()).toHaveLength(1)
    expect(buttons(rows()[0])).toEqual([])
  })

  it('shows nothing when no environment is scheduled for deletion', async () => {
    await render([], true)

    expect(container.textContent).toBe('')
  })
})
