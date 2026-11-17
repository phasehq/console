import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const readiness = {
  canDelete: false,
  requiresReauth: false,
  blockers: [{ kind: 'sole_owner', organisationId: 'org-1', organisationName: 'acme', detail: '' }],
}

jest.mock(
  '@/graphql/queries/account/getAccountDeletionReadiness.gql',
  () => ({ GetAccountDeletionReadiness: {} }),
  { virtual: true }
)
jest.mock('@/graphql/mutations/account/deleteAccount.gql', () => ({ DeleteAccountOp: {} }), {
  virtual: true,
})
jest.mock('@apollo/client', () => ({
  useQuery: () => ({
    data: { accountDeletionReadiness: readiness },
    loading: false,
    refetch: jest.fn(),
  }),
  useMutation: () => [jest.fn(), { loading: false }],
}))
jest.mock('@/contexts/userContext', () => ({
  useUser: () => ({ user: { email: 'ada@acme.test' } }),
}))
jest.mock('@/contexts/organisationContext', () => {
  const React = require('react')
  return { organisationContext: React.createContext({ organisations: null }) }
})
jest.mock('@/apollo/client', () => ({ handleSignout: jest.fn() }))
jest.mock('@/components/account/useReauthState', () => ({
  useReauthGuard: () => () => true,
  useReauthRestore: () => {},
  useReauthStateSync: () => {},
}))
jest.mock('next/link', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: ({ href, children }: { href: string; children: React.ReactNode }) =>
      React.createElement('a', { href }, children),
  }
})

import DeleteAccountSection from '@/components/account/DeleteAccountSection'
import { organisationContext } from '@/contexts/organisationContext'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const render = async (deletionScheduledFor: string | null) => {
  const container = document.createElement('div')
  const organisations = [{ id: 'org-1', name: 'acme', deletionScheduledFor }]
  await act(async () => {
    createRoot(container).render(
      <organisationContext.Provider value={{ organisations } as any}>
        <DeleteAccountSection />
      </organisationContext.Provider>
    )
  })
  return container
}

describe('DeleteAccountSection sole-owner blocker', () => {
  it('asks the owner of an active org to transfer ownership', async () => {
    const container = await render(null)
    expect(container.textContent).toContain('You must transfer ownership')
    expect(container.querySelector('a[href="/acme/settings?tab=organisation"]')).not.toBeNull()
  })

  it('tells the owner of an org pending deletion to wait for it', async () => {
    const container = await render('2026-10-25T11:12:00Z')
    expect(container.textContent).toContain('acme is scheduled for deletion on')
    expect(container.textContent).toContain(
      'You can delete your account after it has been deleted.'
    )
    expect(container.textContent).not.toContain('transfer ownership')
    expect(container.querySelector('a')).toBeNull()
  })
})
