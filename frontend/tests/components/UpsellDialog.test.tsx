import React, { act, Suspense } from 'react'
import { createRoot } from 'react-dom/client'

// Use the App Router implementation of next/dynamic (what the console runs on).
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
jest.mock('@/components/common/GenericDialog', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'dialog' }, children),
  }
})
jest.mock('@/ee/billing/UpgradeDialog', () => {
  const React = require('react')
  return { __esModule: true, default: () => React.createElement('div', { id: 'upgrade' }) }
})

import { UpsellDialog } from '@/components/settings/organisation/UpsellDialog'
import { organisationContext } from '@/contexts/organisationContext'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

it('loads the UpgradeDialog chunk inside the dialog instead of suspending the whole page', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(
      <Suspense fallback={<div id="page-fallback" />}>
        <organisationContext.Provider value={{ activeOrganisation: { id: 'org', plan: 'FR' } } as never}>
          <UpsellDialog title="Upgrade" buttonLabel="Delete" />
        </organisationContext.Provider>
      </Suspense>
    )
  })

  // The chunk is still loading here: the page-level fallback must not have replaced the
  // dialog, which shows its own spinner instead.
  expect(container.querySelector('#page-fallback')).toBeNull()
  expect(container.querySelector('[data-testid=dialog] [role=status]')).not.toBeNull()

  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
  expect(container.querySelector('#upgrade')).not.toBeNull()
  expect(container.querySelector('#page-fallback')).toBeNull()

  await act(async () => root.unmount())
  container.remove()
})
