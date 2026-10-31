import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useQuery } from '@apollo/client'
import {
  usePendingAgentRequestCount,
  usePendingRequestFavicon,
  withPendingRequestCount,
} from '@/utils/agents/pendingRequests'

jest.mock('@/graphql/queries/agents/getPendingAgentRequestIds.gql', () => ({
  GetPendingAgentRequestIds: Symbol('GetPendingAgentRequestIds'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useQuery: jest.fn(),
}))
jest.mock('@/contexts/organisationContext', () => {
  const activeOrganisation = { id: 'org-1', role: { permissions: '' } }
  return {
    mockActiveOrganisation: activeOrganisation,
    organisationContext: jest
      .requireActual<typeof React>('react')
      .createContext({ activeOrganisation }),
  }
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const setRequestPermissions = (actions: string[]) => {
  const { mockActiveOrganisation } = jest.requireMock('@/contexts/organisationContext')
  mockActiveOrganisation.role.permissions = JSON.stringify({
    permissions: { AgentRequests: actions },
    app_permissions: {},
    agent_permissions: {},
    global_access: false,
  })
}

describe('pending Agent request cues', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    ;(useQuery as jest.Mock).mockReturnValue({
      data: { agentRequests: [{ id: 'request-1' }, null, { id: 'request-2' }] },
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    document.head.querySelectorAll('link[rel="icon"]').forEach((link) => link.remove())
    jest.clearAllMocks()
  })

  const Count = ({ poll }: { poll?: boolean }) => <>{usePendingAgentRequestCount({ poll })}</>

  test('prefixes the tab title with the count only while requests wait', () => {
    expect(withPendingRequestCount('Apps · acme | Phase Console', 2)).toBe(
      '(2) Apps · acme | Phase Console'
    )
    expect(withPendingRequestCount('Apps · acme | Phase Console', 0)).toBe(
      'Apps · acme | Phase Console'
    )
  })

  test('the polling caller keeps checking in background tabs', async () => {
    setRequestPermissions(['read'])

    await act(async () => root.render(<Count poll />))

    expect(container.textContent).toBe('2')
    const options = (useQuery as jest.Mock).mock.calls[0][1]
    expect(options).toMatchObject({ skip: false, pollInterval: 60_000 })
    expect(options.skipPollAttempt).toBeUndefined()
  })

  test('other callers read the cache without polling', async () => {
    setRequestPermissions(['read'])

    await act(async () => root.render(<Count />))

    expect(container.textContent).toBe('2')
    expect((useQuery as jest.Mock).mock.calls[0][1]).toMatchObject({
      fetchPolicy: 'cache-only',
      pollInterval: undefined,
    })
  })

  test('counts nothing for members who cannot read Agent requests', async () => {
    setRequestPermissions([])

    await act(async () => root.render(<Count poll />))

    expect(container.textContent).toBe('0')
    expect((useQuery as jest.Mock).mock.calls[0][1]).toMatchObject({ skip: true })
  })

  test('swaps in the favicon with a dot while requests wait, and restores it', async () => {
    const icon = document.createElement('link')
    icon.rel = 'icon'
    icon.type = 'image/svg+xml'
    icon.setAttribute('href', '/favicon.svg')
    document.head.appendChild(icon)
    const Favicon = ({ pending }: { pending: boolean }) => {
      usePendingRequestFavicon(pending)
      return null
    }

    await act(async () => root.render(<Favicon pending />))
    expect(icon.getAttribute('href')).toBe('/assets/images/favicon-attention.svg')

    await act(async () => root.render(<Favicon pending={false} />))
    expect(icon.getAttribute('href')).toBe('/favicon.svg')
  })
})
