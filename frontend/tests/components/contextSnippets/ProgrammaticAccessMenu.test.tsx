import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

const mockParams: { current: { app: string; path?: string[] } } = { current: { app: 'app-1' } }

jest.mock('next/navigation', () => ({ useParams: () => mockParams.current }))
jest.mock(
  '@/graphql/queries/secrets/getAppEnvironments.gql',
  () => ({ GetAppEnvironments: 'GetAppEnvironments' }),
  { virtual: true }
)
jest.mock('@apollo/client', () => ({
  useLazyQuery: () => [
    () => {},
    { data: { appEnvironments: [{ id: 'env-1', name: 'Development', app: { name: 'api' } }] } },
  ],
}))
jest.mock('@/contexts/organisationContext', () => {
  const React = require('react')
  return { organisationContext: React.createContext({ activeOrganisation: { id: 'org-1' } }) }
})
jest.mock('@/app/[team]/apps/[app]/_components/EnvSelectionProvider', () => ({
  useEnvSelection: () => ({ selectedEnvIds: null }),
  filterEnvSelection: (envs: unknown[]) => envs,
}))
jest.mock('@/components/contextSnippets/SecretsOneLiner', () => ({
  __esModule: true,
  default: ({ type, path }: { type: string; path: string }) => (
    <code data-testid={`one-liner-${type}`}>{path}</code>
  ),
}))

import { ProgrammaticAccessMenu } from '@/components/contextSnippets/ProgrammaticAccessMenu'
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

describe('ProgrammaticAccessMenu', () => {
  let container: HTMLDivElement
  let root: Root

  /** The folder path both one-liners are generated for, with the grid at these URL segments */
  const pathsFor = async (path?: string[]) => {
    mockParams.current = { app: 'app-1', path }
    await act(async () => root.render(<ProgrammaticAccessMenu />))
    await act(async () => container.querySelector('button')!.click())
    return ['cli', 'api'].map(
      (type) => container.querySelector(`[data-testid=one-liner-${type}]`)?.textContent
    )
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

  it('targets the folder in view', async () => {
    expect(await pathsFor(['backend', 'api'])).toEqual(['backend/api', 'backend/api'])
  })

  it('targets the root when the grid is at the root', async () => {
    expect(await pathsFor(undefined)).toEqual(['', ''])
  })

  it('leaves out the escape a folder named like an app page is opened behind', async () => {
    expect(await pathsFor(['~', 'settings', 'api'])).toEqual(['settings/api', 'settings/api'])
  })

  it('keeps a root folder that is itself named ~', async () => {
    expect(await pathsFor(['~', '~'])).toEqual(['~', '~'])
  })
})
