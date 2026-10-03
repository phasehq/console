import React, { act, useContext, useEffect, useState } from 'react'
import { createRoot, Root } from 'react-dom/client'

// --- mocks -----------------------------------------------------------------

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
// Render children directly so the test doesn't depend on Headless UI's portal/transition machinery
jest.mock('@/components/common/GenericDialog', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'dialog' }, children),
}))

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

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const org = { id: 'org-1', plan: 'FR', role: { permissions: '{}' } } as any

// Simulates the page around the dialog (e.g. AppEnvironments re-rendering on its 10s poll)
let rerenderParent: () => void = () => {}
function Parent() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    rerenderParent = () => setTick((t) => t + 1)
  })
  return (
    <organisationContext.Provider value={{ activeOrganisation: org } as any}>
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

describe('UpsellDialog keeps the UpgradeDialog mounted across parent re-renders', () => {
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
