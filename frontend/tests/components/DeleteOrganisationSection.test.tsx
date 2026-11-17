import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const checkInvoices = jest.fn()
let invoicesData: { organisationHasPendingInvoices: boolean } | undefined

jest.mock(
  '@/graphql/mutations/organisation/deleteOrganisation.gql',
  () => ({ DeleteOrganisationOp: {} }),
  { virtual: true }
)
jest.mock(
  '@/graphql/queries/organisation/getOrganisationPendingInvoices.gql',
  () => ({ GetOrganisationPendingInvoices: {} }),
  { virtual: true }
)
jest.mock('@apollo/client', () => ({
  useMutation: () => [jest.fn(), { loading: false }],
  useLazyQuery: () => [checkInvoices, { data: invoicesData }],
}))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@/utils/appConfig', () => ({ isCloudHosted: () => true }))
jest.mock('@/contexts/organisationContext', () => {
  const React = require('react')
  return {
    organisationContext: React.createContext({
      activeOrganisation: { id: 'org-1', name: 'acme', plan: 'PR' },
    }),
  }
})
// Render the dialog open: its body shows and onOpen fires, as when the owner opens it.
jest.mock('@/components/common/GenericDialog', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: React.forwardRef(function GenericDialog(
      { children, onOpen }: { children: React.ReactNode; onOpen?: () => void },
      _ref: unknown
    ) {
      React.useEffect(() => onOpen?.(), [onOpen])
      return React.createElement('div', null, children)
    }),
  }
})

import { DeleteOrganisationSection } from '@/components/settings/organisation/DeleteOrganisationSection'
import { organisationContext } from '@/contexts/organisationContext'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const render = async () => {
  const container = document.createElement('div')
  await act(async () => {
    createRoot(container).render(<DeleteOrganisationSection />)
  })
  return container
}

const renderFor = async (activeOrganisation: object) => {
  const container = document.createElement('div')
  await act(async () => {
    createRoot(container).render(
      <organisationContext.Provider
        value={{ activeOrganisation } as unknown as React.ContextType<typeof organisationContext>}
      >
        <DeleteOrganisationSection />
      </organisationContext.Provider>
    )
  })
  return container
}

const deleteButton = (container: HTMLElement) =>
  container.querySelector('button[type="submit"]') as HTMLButtonElement

beforeEach(() => {
  checkInvoices.mockReset()
  invoicesData = undefined
})

describe('DeleteOrganisationSection on Phase Cloud', () => {
  it('checks for pending invoices when the dialog opens', async () => {
    await render()
    expect(checkInvoices).toHaveBeenCalledWith({ variables: { organisationId: 'org-1' } })
  })

  it('warns about pending invoices and blocks the delete', async () => {
    invoicesData = { organisationHasPendingInvoices: true }
    const container = await render()
    expect(container.textContent).toContain(
      'You have pending invoices. Please pay them before this organisation can be deleted.'
    )
    expect(deleteButton(container).disabled).toBe(true)
  })

  it('shows no warning when nothing is pending', async () => {
    invoicesData = { organisationHasPendingInvoices: false }
    const container = await render()
    expect(container.textContent).not.toContain('pending invoices')
  })

  it('asks to confirm the permanent deletion', async () => {
    const container = await render()
    expect(container.textContent).toContain('Are you sure you want to permanently delete acme?')
    expect(container.textContent).toContain(
      'In 7 days, the organisation and all associated data will be permanently deleted.'
    )
  })

  it.each([
    [
      'PR',
      "Your Phase Pro subscription won't renew, and will be cancelled when the organisation is deleted.",
    ],
    [
      'EN',
      "Your Phase Enterprise subscription won't renew, and will be cancelled when the organisation is deleted.",
    ],
  ])('says the %s subscription ends with the organisation', async (plan, text) => {
    const container = await renderFor({ id: 'org-1', name: 'acme', plan })
    expect(container.textContent).toContain(text)
  })

  it('says nothing about a subscription on the Free plan', async () => {
    const container = await renderFor({ id: 'org-1', name: 'acme', plan: 'FR' })
    expect(container.textContent).not.toContain('subscription')
  })
})
