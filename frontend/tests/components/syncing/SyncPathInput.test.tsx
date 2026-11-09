import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { SyncPathInput } from '@/components/syncing/SyncPathInput'
import { EnvironmentType } from '@/apollo/graphql'

jest.mock('@/graphql/queries/syncing/getSyncPathStats.gql', () => ({}), { virtual: true })

const queryResult = {
  loading: false,
  data: {
    folders: [
      { id: 'f1', name: 'workers', path: '/' },
      { id: 'f2', name: 'cron', path: '/workers' },
    ],
    secretCountsByPath: [
      { path: '/', secretCount: 1 },
      { path: '/workers', secretCount: 2 },
      { path: '/workers/cron', secretCount: 1 },
      // Secrets at a path that has no folder
      { path: '/legacy', secretCount: 4 },
    ],
  },
}
jest.mock('@apollo/client', () => ({ useQuery: () => queryResult }))
jest.mock('@/contexts/organisationContext', () => ({
  organisationContext: jest
    .requireActual('react')
    .createContext({ activeOrganisation: { id: 'org-1', name: 'acme' } }),
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// Browser APIs Headless UI uses that jsdom lacks
const globals = globalThis as unknown as Record<string, unknown>
globals.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const elementPrototype = Element.prototype as unknown as Record<string, unknown>
elementPrototype.getAnimations ??= () => []
elementPrototype.scrollIntoView ??= () => {}

const env = { id: 'env-1', name: 'production' } as EnvironmentType

describe('SyncPathInput', () => {
  let container: HTMLDivElement
  let root: Root

  const render = async (path: string) => {
    const setPath = jest.fn()
    await act(async () => {
      root.render(<SyncPathInput appId="app-1" env={env} path={path} setPath={setPath} />)
    })
    return { setPath, input: container.querySelector('input') as HTMLInputElement }
  }

  const press = async (element: HTMLElement, key: string) => {
    await act(async () => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }

  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }

  const optionTexts = () =>
    Array.from(document.querySelectorAll('[role="option"]')).map((option) => option.textContent)

  const activeOption = () => document.querySelector('[role="option"][data-focus]')?.textContent

  const typeInto = async (path: string, text: string) => {
    const rendered = await render(path)
    await act(async () => rendered.input.focus())
    await type(rendered.input, text)
    return rendered
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('summarises what the chosen path syncs and links to it', async () => {
    await render('/workers')

    expect(container.textContent).toContain('Syncs 2 secrets from /workers in production')
    expect(container.textContent).toContain("Secrets in its 1 subfolder aren't included")

    const link = Array.from(container.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('View folder')
    )
    expect(link?.getAttribute('href')).toBe('/acme/apps/app-1/environments/env-1/workers')
    expect(link?.getAttribute('target')).toBe('_blank')
  })

  it('warns when the path has no folder', async () => {
    await render('/missing')
    expect(container.textContent).toContain("There's no folder at /missing in production")
  })

  it('counts secrets at a path that has no folder', async () => {
    await render('/legacy')
    expect(container.textContent).toContain('Syncs 4 secrets from /legacy in production')
  })

  it('lists the folders on focus', async () => {
    const { input } = await render('/')
    await act(async () => input.focus())
    await press(input, 'ArrowDown')

    expect(optionTexts()).toHaveLength(3)
  })

  it('picks the typed path on Enter, not the first folder that matches', async () => {
    const { input, setPath } = await typeInto('/', 'work')

    expect(optionTexts()[0]).toContain('Use /work')
    expect(activeOption()).toContain('Use /work')
    await press(input, 'Enter')

    expect(setPath).toHaveBeenCalledTimes(1)
    expect(setPath).toHaveBeenLastCalledWith('/work')
  })

  it('picks the typed path on Enter when the chosen path still matches', async () => {
    const { input, setPath } = await typeInto('/workers', 'work')

    expect(activeOption()).toContain('Use /work')
    await press(input, 'Enter')

    expect(setPath).toHaveBeenLastCalledWith('/work')
  })

  it('picks an existing folder typed in full', async () => {
    const { input, setPath } = await typeInto('/', 'workers/')
    await press(input, 'Enter')

    expect(setPath).toHaveBeenLastCalledWith('/workers')
  })

  it('picks a folder reached with the arrow keys', async () => {
    const { input, setPath } = await typeInto('/', 'cron')

    expect(optionTexts()).toHaveLength(2) // the typed path, then the match
    await press(input, 'ArrowDown')
    await press(input, 'Enter')

    expect(setPath).toHaveBeenLastCalledWith('/workers/cron')
  })

  it('accepts a path that has no folder yet', async () => {
    const { input, setPath } = await typeInto('/', 'new/folder/')
    await press(input, 'Enter')

    expect(setPath).toHaveBeenLastCalledWith('/new/folder')
  })

  it('keeps what was typed on Tab, without picking the highlighted folder', async () => {
    const { input, setPath } = await typeInto('/', 'work')
    await press(input, 'ArrowDown')
    expect(activeOption()).toContain('workers')

    await press(input, 'Tab')

    expect(setPath).toHaveBeenCalledTimes(1)
    expect(setPath).toHaveBeenLastCalledWith('/work')
  })

  it("doesn't pick the highlighted folder on Tab when nothing was typed", async () => {
    const { input, setPath } = await render('/')
    await act(async () => input.focus())
    await press(input, 'ArrowDown')
    expect(activeOption()).toContain('workers')

    await press(input, 'Tab')

    expect(setPath).not.toHaveBeenCalled()
  })

  it('discards what was typed on Escape', async () => {
    const { input, setPath } = await typeInto('/', 'work')
    await press(input, 'Escape')

    expect(setPath).not.toHaveBeenCalled()
  })

  it('keeps what was typed when focus moves elsewhere', async () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const { setPath } = await typeInto('/', 'work')

    await act(async () => {
      outside.focus()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(setPath).toHaveBeenLastCalledWith('/work')
    outside.remove()
  })

  it("opens a folder's link without picking the folder or taking focus", async () => {
    const { input, setPath } = await render('/')
    await act(async () => input.focus())
    await press(input, 'ArrowDown')

    const link = document.querySelector('a[aria-label="Open /workers in a new tab"]')!
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
    await act(async () => {
      link.dispatchEvent(mousedown)
    })

    // Default prevented, so focus stays in the input
    expect(mousedown.defaultPrevented).toBe(true)
    expect(setPath).not.toHaveBeenCalled()
    expect(optionTexts()).toHaveLength(3)
  })
})
