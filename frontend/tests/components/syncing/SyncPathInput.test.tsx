import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { SyncPathInput } from '@/components/syncing/SyncPathInput'
import { EnvironmentType } from '@/apollo/graphql'

jest.mock('@/graphql/queries/syncing/getSyncPathStats.gql', () => ({}), { virtual: true })

const queryResult = {
  loading: false,
  data: {
    folders: [
      { id: 'f1', name: 'workers', path: '/', folderCount: 1, secretCount: 3 },
      { id: 'f2', name: 'cron', path: '/workers', folderCount: 0, secretCount: 1 },
    ],
    secrets: [
      { id: 's1', path: '/' },
      { id: 's2', path: '/workers' },
      { id: 's3', path: '/workers' },
      { id: 's4', path: '/workers/cron' },
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

  it('lists folders on focus and picks one with the keyboard', async () => {
    const { input, setPath } = await render('/')
    await act(async () => input.focus())
    await press(input, 'ArrowDown')

    expect(optionTexts()).toHaveLength(3)

    await type(input, 'cron')
    expect(optionTexts()).toHaveLength(2) // the match, and the typed path
    await press(input, 'Enter')

    expect(setPath).toHaveBeenLastCalledWith('/workers/cron')
  })

  it('accepts a path that has no folder yet', async () => {
    const { input, setPath } = await render('/')
    await act(async () => input.focus())
    await type(input, 'new/folder/')
    await press(input, 'Enter')

    expect(setPath).toHaveBeenLastCalledWith('/new/folder')
  })
})
