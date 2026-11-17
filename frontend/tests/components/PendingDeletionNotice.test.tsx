import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { PendingDeletionNotice } from '@/components/settings/organisation/PendingDeletionNotice'
import { OrganisationType } from '@/apollo/graphql'

jest.mock(
  '@/graphql/mutations/organisation/restoreOrganisation.gql',
  () => ({ RestoreOrganisationOp: {} }),
  { virtual: true }
)
jest.mock('@apollo/client', () => ({
  useMutation: () => [jest.fn(), { loading: false }],
}))
jest.mock('react-toastify', () => ({ toast: { success: jest.fn() } }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const pendingOrg = {
  id: 'org-1',
  name: 'Acme',
  role: { name: 'Owner' },
  deletedAt: '2026-10-12T12:00:00Z',
  deletionScheduledFor: '2026-10-19T12:00:00Z',
  deletionDelayed: false,
} as unknown as OrganisationType

describe('PendingDeletionNotice', () => {
  let container: HTMLDivElement
  let root: Root

  const render = async (organisation: OrganisationType) => {
    await act(async () => {
      root.render(<PendingDeletionNotice organisation={organisation} />)
    })
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

  it('shows the deletion date', async () => {
    await render(pendingOrg)

    expect(container.textContent).toContain('Scheduled for deletion on')
    expect(container.textContent).toContain('Restore organisation')
  })

  it('says when the deletion is delayed, and still offers restore', async () => {
    await render({ ...pendingOrg, deletionDelayed: true })

    expect(container.textContent).toContain(
      "Deletion delayed: Phase couldn't revoke some credentials"
    )
    expect(container.textContent).not.toContain('Scheduled for deletion on')
    expect(container.textContent).toContain('Restore organisation')
  })
})
