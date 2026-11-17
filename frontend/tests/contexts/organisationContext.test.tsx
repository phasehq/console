import React, { act, useContext } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { OrganisationProvider, organisationContext } from '@/contexts/organisationContext'

jest.mock('@/graphql/queries/getOrganisations.gql', () => ({}), { virtual: true })
jest.mock('@/graphql/mutations/organisation/updateUserWrappedSecrets.gql', () => ({}), {
  virtual: true,
})
jest.mock('posthog-js', () => ({ __esModule: true, default: { identify: jest.fn() } }))
jest.mock('@/utils/localStorage', () => ({ getLocalKeyring: jest.fn() }))
jest.mock('@/contexts/userContext', () => ({
  useSession: () => ({ data: { user: { email: 'owner@acme.test', name: 'Owner' } } }),
}))

// What the polled GetOrganisations query currently returns.
let mockOrganisations: object[] = []
jest.mock('@apollo/client', () => ({
  useLazyQuery: () => [jest.fn(), { data: { organisations: mockOrganisations }, loading: false }],
  useMutation: () => [jest.fn()],
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const acme = { id: 'org-1', name: 'Acme', keyring: 'k', recovery: 'r', deletedAt: null }

function ActiveOrganisation() {
  const { activeOrganisation } = useContext(organisationContext)
  return <div data-active={activeOrganisation?.name ?? ''} />
}

describe('OrganisationProvider', () => {
  let container: HTMLDivElement
  let root: Root

  const render = async () => {
    await act(async () => {
      root.render(
        <OrganisationProvider>
          <ActiveOrganisation />
        </OrganisationProvider>
      )
    })
  }
  const active = () => container.querySelector('div')?.getAttribute('data-active')

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('selects the only org', async () => {
    mockOrganisations = [acme]
    await render()

    expect(active()).toBe('Acme')
  })

  it('does not select an only org that is pending deletion', async () => {
    mockOrganisations = [{ ...acme, deletedAt: '2026-10-19T12:00:00Z' }]
    await render()

    expect(active()).toBe('')
  })

  it('drops the active org once it is purged', async () => {
    mockOrganisations = [acme]
    await render()
    expect(active()).toBe('Acme')

    // The next poll no longer returns it.
    mockOrganisations = []
    await render()

    expect(active()).toBe('')
  })

  it('drops the active org once it is pending deletion', async () => {
    mockOrganisations = [acme]
    await render()

    mockOrganisations = [{ ...acme, deletedAt: '2026-10-19T12:00:00Z' }]
    await render()

    expect(active()).toBe('')
  })
})
