import { act } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { toast } from 'react-toastify'

import {
  EnvSelectionProvider,
  useEnvSelection,
} from '@/app/[team]/apps/[app]/_components/EnvSelectionProvider'

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
jest.mock('react-toastify', () => ({ toast: { warn: jest.fn() } }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const ALL = ['dev', 'staging', 'prod']

describe('EnvSelectionProvider', () => {
  let container: HTMLDivElement
  let root: Root
  let selection: ReturnType<typeof useEnvSelection>

  const Probe = () => {
    selection = useEnvSelection()
    return null
  }

  beforeEach(async () => {
    window.history.replaceState(null, '', '/acme/apps/app-1')
    localStorage.setItem('phase-env-selection-app-1', JSON.stringify(['staging', 'prod']))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    jest.clearAllMocks()
    await act(async () =>
      root.render(
        <EnvSelectionProvider appId="app-1">
          <Probe />
        </EnvSelectionProvider>
      )
    )
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    localStorage.clear()
  })

  it('shows only one environment, then goes back to what was shown', async () => {
    await act(async () => selection.soloEnv('dev', ALL))
    expect(selection.selectedEnvIds).toEqual(['dev'])

    await act(async () => selection.soloEnv('dev', ALL))
    expect(selection.selectedEnvIds).toEqual(['staging', 'prod'])
  })

  it('does not go back to a selection that would hide an environment with undeployed changes', async () => {
    await act(async () => selection.soloEnv('dev', ALL))
    selection.setDirtyEnvIds(new Set(['dev']))

    await act(async () => selection.soloEnv('dev', ALL))
    expect(selection.selectedEnvIds).toEqual(['dev'])
    expect(toast.warn).toHaveBeenCalledTimes(1)

    // Once deployed or discarded, it goes back as before
    selection.setDirtyEnvIds(new Set())
    await act(async () => selection.soloEnv('dev', ALL))
    expect(selection.selectedEnvIds).toEqual(['staging', 'prod'])
  })

  it('refuses to hide an environment with undeployed changes', async () => {
    selection.setDirtyEnvIds(new Set(['staging']))

    await act(async () => selection.toggleEnv('staging', ALL))
    expect(selection.selectedEnvIds).toEqual(['staging', 'prod'])
    await act(async () => selection.soloEnv('prod', ALL))
    expect(selection.selectedEnvIds).toEqual(['staging', 'prod'])
    expect(toast.warn).toHaveBeenCalledTimes(2)
  })
})
