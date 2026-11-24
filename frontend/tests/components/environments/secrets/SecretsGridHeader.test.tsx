import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

// The header's dialogs and syncs menu bring their own queries; the columns under test need none
jest.mock('@/components/environments/CreateEnvironmentDialog', () => ({
  CreateEnvironmentDialog: () => null,
}))
jest.mock('@/components/environments/ManageEnvironmentDialog', () => ({
  ManageEnvironmentDialog: () => null,
}))
jest.mock('@/components/syncing/EnvSyncsMenu', () => ({ EnvSyncsMenu: () => null }))

import { SecretsGridHeader } from '@/app/[team]/apps/[app]/_components/SecretsGridHeader'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const env = (id: string, name: string) => ({ id, name, color: null }) as never
const columns = (...checked: string[]) =>
  [env('env-1', 'Development'), env('env-2', 'Staging'), env('env-3', 'Production')].map(
    (environment: { id: string }) => ({
      env: environment,
      checked: checked.includes(environment.id),
      pending: false,
    })
  ) as never

describe('SecretsGridHeader column resizing', () => {
  let container: HTMLDivElement
  let root: Root
  const onResize = jest.fn()
  const onResizePreview = jest.fn()

  const render = (shown: string[]) =>
    act(async () => {
      root.render(
        <table>
          <SecretsGridHeader
            columns={columns(...shown)}
            appId="app-1"
            canCreateEnvironments={false}
            allowReordering
            dirtyEnvIds={new Set()}
            onToggle={() => {}}
            onSolo={() => {}}
            onMove={() => {}}
            onDrop={() => {}}
            onExport={() => {}}
            revealedEnvIds={new Set()}
            onToggleReveal={() => {}}
            keyColumnId="key:app-1"
            onResizePreview={onResizePreview}
            onResize={onResize}
            newEnvironmentRef={{ current: null }}
            envContents={() => null}
          />
        </table>
      )
    })
  const handle = (name: string) =>
    container.querySelector<HTMLElement>(`[role="separator"][aria-label="Resize ${name}"]`)
  const pointer = (target: HTMLElement, type: string, clientX: number) =>
    act(async () => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX }))
    })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onResize.mockClear()
    onResizePreview.mockClear()
    // jsdom lays nothing out and has no pointer capture: every header is 300px wide here
    jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 300 } as DOMRect)
    HTMLElement.prototype.setPointerCapture = jest.fn()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.restoreAllMocks()
  })

  it('gives an env shown on its own a handle, saving under an id of its own', async () => {
    await render(['env-2'])
    expect(handle('Staging')).not.toBeNull()
    // The hidden envs are slim columns: nothing to resize
    expect(handle('Development')).toBeNull()

    await act(async () => {
      handle('Staging')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      )
    })
    expect(onResize).toHaveBeenLastCalledWith('solo:env-2', 316)

    await act(async () => {
      handle('Staging')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(onResize).toHaveBeenLastCalledWith('solo:env-2', null)
  })

  it("saves under the env's own id among other envs", async () => {
    await render(['env-1', 'env-2'])
    await act(async () => {
      handle('Staging')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true })
      )
    })
    expect(onResize).toHaveBeenLastCalledWith('env-2', 236)
  })

  it('saves a drag when the pointer is released, and undoes one that ends where it began', async () => {
    await render(['env-2'])
    const staging = handle('Staging')!

    await pointer(staging, 'pointerdown', 500)
    await pointer(staging, 'pointermove', 420)
    await pointer(staging, 'pointerup', 420)
    expect(onResize).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenLastCalledWith('solo:env-2', 220)

    onResize.mockClear()
    await pointer(staging, 'pointerdown', 500)
    await pointer(staging, 'pointermove', 440)
    await pointer(staging, 'pointermove', 500)
    await pointer(staging, 'pointerup', 500)
    expect(onResize).not.toHaveBeenCalled()
    // The widths the drag put on the table go back to the saved ones
    expect(onResizePreview).toHaveBeenLastCalledWith('solo:env-2', null)
  })
})

describe('SecretsGridHeader columns scheduled for deletion', () => {
  let container: HTMLDivElement
  let root: Root
  const onOpenDeleted = jest.fn()
  const onToggle = jest.fn()

  const deleted = (canRestore: boolean) => ({
    id: 'env-2',
    name: 'Staging',
    envType: 'STAGING',
    index: 1,
    deletedAt: '2026-11-22T12:00:00Z',
    deletionScheduledFor: '2026-11-23T12:00:00Z',
    deletionDelayed: false,
    canRestore,
  })
  const render = (canRestore: boolean) =>
    act(async () => {
      root.render(
        <table>
          <SecretsGridHeader
            columns={
              [
                { env: env('env-1', 'Development'), checked: true, pending: false },
                {
                  env: env('env-2', 'Staging'),
                  checked: false,
                  pending: false,
                  deleted: deleted(canRestore),
                },
                { env: env('env-3', 'Production'), checked: false, pending: false },
              ] as never
            }
            appId="app-1"
            canCreateEnvironments={false}
            allowReordering
            dirtyEnvIds={new Set()}
            onToggle={onToggle}
            onSolo={() => {}}
            onMove={() => {}}
            onDrop={() => {}}
            onExport={() => {}}
            revealedEnvIds={new Set()}
            onToggleReveal={() => {}}
            keyColumnId="key:app-1"
            onResizePreview={() => {}}
            onResize={() => {}}
            newEnvironmentRef={{ current: null }}
            envContents={() => null}
            onOpenDeleted={onOpenDeleted}
          />
        </table>
      )
    })
  const header = () => container.querySelector<HTMLElement>('th[data-deleted]')!

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onOpenDeleted.mockClear()
    onToggle.mockClear()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('stands between its neighbours with a clock, and opens the environment when clicked', async () => {
    await render(true)
    const headers = Array.from(container.querySelectorAll('th[data-env-column]'))
    expect(headers.indexOf(header())).toBe(1)
    expect(header().dataset.deleted).toBe('scheduled')

    const button = header().querySelector('button')!
    expect(button.getAttribute('aria-label')).toMatch(/^Staging: Will be deleted on /)
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.querySelector('[role="status"]')).toBeNull()

    await act(async () => button.click())
    expect(onOpenDeleted).toHaveBeenCalledWith('env-2')
    // It is no hidden env: clicking it shows nothing
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('shows a spinner once it is being deleted', async () => {
    await render(false)
    expect(header().dataset.deleted).toBe('deleting')

    const button = header().querySelector('button')!
    expect(button.getAttribute('aria-label')).toBe('Staging: Being deleted')
    expect(button.querySelector('[role="status"]')).not.toBeNull()
  })

  it("can be neither dragged nor resized, and has none of an env column's controls", async () => {
    await render(true)
    expect(header().getAttribute('draggable')).toBeNull()
    expect(header().querySelector('[role="separator"]')).toBeNull()
    expect(header().querySelectorAll('button')).toHaveLength(1)
    // The hidden env beside it keeps its own: it can still be dragged and shown
    const hidden = container.querySelector<HTMLElement>('th:has(button[title="Show Production"])')!
    expect(hidden.getAttribute('draggable')).toBe('true')
  })
})
