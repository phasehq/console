import React, { act, Suspense, useEffect, useState } from 'react'
import { createRoot, Root } from 'react-dom/client'

// --- mocks -----------------------------------------------------------------

// The console is an App Router app, where `next/dynamic` resolves to the app-router
// implementation (no Suspense boundary of its own unless `loading` is set). Jest would
// otherwise pick up the pages-router implementation, which behaves differently.
jest.mock('next/dynamic', () => jest.requireActual('next/dist/shared/lib/app-dynamic'))
jest.mock('@/utils/appConfig', () => ({ isCloudHosted: () => true }))
jest.mock('@/utils/access/permissions', () => ({ userHasPermission: () => true }))
jest.mock(
  '@/graphql/queries/organisation/getOrganisationPlan.gql',
  () => ({ GetOrganisationPlan: {} }),
  { virtual: true }
)
jest.mock('@apollo/client', () => ({
  useQuery: () => ({ data: { organisationPlan: { seatsUsed: { total: 3 } } }, loading: false }),
}))
jest.mock('@/contexts/organisationContext', () => {
  const React = require('react')
  return { organisationContext: React.createContext({ activeOrganisation: null }) }
})
// Render the dialog chrome inline so the test doesn't depend on Headless UI's portal/transition machinery
jest.mock('@/components/common/GenericDialog', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: ({ title, children }: { title: string; children: React.ReactNode }) =>
      React.createElement(
        'div',
        { 'data-testid': 'dialog' },
        React.createElement('h3', null, title),
        children
      ),
  }
})

// Stand-in for the real UpgradeDialog: counts mounts and holds "checkout" state like the real one does.
let mounts = 0
jest.mock('@/ee/billing/UpgradeDialog', () => {
  const React = require('react')
  const Fake = () => {
    const [step, setStep] = React.useState('preview')
    React.useEffect(() => {
      mounts += 1
    }, [])
    return React.createElement(
      'button',
      { id: 'upgrade', 'data-step': step, onClick: () => setStep('checkout') },
      step
    )
  }
  return { __esModule: true, default: Fake }
})

import { UpsellDialog } from '@/components/settings/organisation/UpsellDialog'
import { organisationContext } from '@/contexts/organisationContext'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

const org = { id: 'org-1', plan: 'FR', role: { permissions: '{}' } } as never

// Simulates the page around the dialog (e.g. AppEnvironments re-rendering on its 10s poll)
let rerenderParent: () => void = () => {}
function Parent() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    rerenderParent = () => setTick((t) => t + 1)
  })
  return (
    <organisationContext.Provider value={{ activeOrganisation: org } as never}>
      <div data-tick={tick}>
        <UpsellDialog title="Upgrade" buttonLabel="Delete" />
      </div>
    </organisationContext.Provider>
  )
}

async function flush() {
  // let next/dynamic resolve the import and React commit
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

describe('UpsellDialog', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mounts = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  // NOTE: this must run first in the file – it relies on the UpgradeDialog chunk not having
  // been loaded yet by an earlier test (the lazy import resolves once per module instance).
  it('loads the UpgradeDialog chunk inside the dialog instead of suspending the whole page', async () => {
    act(() => {
      root.render(
        <Suspense fallback={<div id="page-fallback">page spinner</div>}>
          <Parent />
        </Suspense>
      )
    })

    // The chunk is still loading here (the import resolves on a later microtask).
    // The route-level fallback must NOT have replaced the page, and the dialog must still
    // be rendered with its own loading indicator inside it.
    expect(container.querySelector('#page-fallback')).toBeNull()
    expect(container.querySelector('[data-testid=dialog] h3')?.textContent).toBe('Upgrade')
    expect(container.querySelector('[data-testid=dialog] [role=status]')).not.toBeNull()

    await flush()
    expect(container.querySelector('#upgrade')).not.toBeNull()
    expect(container.querySelector('[data-testid=dialog] [role=status]')).toBeNull()
    expect(container.querySelector('#page-fallback')).toBeNull()
  })

  it('does not remount UpgradeDialog (and lose checkout state) when the parent re-renders', async () => {
    await act(async () => {
      root.render(<Parent />)
    })
    await flush()

    const button = () => container.querySelector('#upgrade') as HTMLButtonElement
    expect(button()).not.toBeNull()
    expect(mounts).toBe(1)

    // user clicks "Start 14-day trial" -> UpgradeDialog switches to the checkout step
    await act(async () => {
      button().click()
    })
    expect(button().dataset.step).toBe('checkout')

    // something above re-renders (org context poll, AppEnvironments poll, ...)
    await act(async () => rerenderParent())
    await flush()

    expect(button().dataset.step).toBe('checkout') // state must survive
    expect(mounts).toBe(1) // must not have remounted
  })
})
