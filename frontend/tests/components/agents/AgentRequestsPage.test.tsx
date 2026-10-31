import React, { act, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import AgentRequestsPage from '@/app/[team]/agents/requests/page'

jest.mock('@/graphql/queries/agents/getAgentRequests.gql', () => ({
  GetAgentRequests: Symbol('GetAgentRequests'),
}))
jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({
  ResolveAgentRequestOp: Symbol('ResolveAgentRequestOp'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}))
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('request=request-1&action=setup'),
}))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
jest.mock('@/contexts/organisationContext', () => {
  const activeOrganisation = { id: 'org-1', memberId: 'member-1', role: { permissions: '' } }
  return {
    mockActiveOrganisation: activeOrganisation,
    organisationContext: jest
      .requireActual<typeof React>('react')
      .createContext({ activeOrganisation }),
  }
})
jest.mock('@/components/agents/AgentDialogs', () => ({
  DenyAgentRequestDialog: ({ onDeny }: any) => (
    <>
      <button type="button" onClick={() => onDeny('')}>
        Deny
      </button>
      <button type="button" onClick={() => onDeny('Use the read-only role instead.')}>
        Deny with note
      </button>
    </>
  ),
}))
jest.mock('@/components/agents/AgentSetupRequestDialog', () => ({
  AgentSetupRequestDialog: ({ request, autoOpen, onAutoOpened }: any) => (
    <>
      <button type="button" data-request={request.id} data-auto-open={String(autoOpen)}>
        {request.kind.toLowerCase() === 'credential_update'
          ? 'Update credentials'
          : 'Set up Connection'}
      </button>
      <button type="button" onClick={onAutoOpened}>
        Auto-opened
      </button>
    </>
  ),
}))
jest.mock('@/components/agents/HardenedRequestMarkdown', () => ({
  HardenedRequestMarkdown: ({ text }: { text: string }) => <p>{text}</p>,
}))
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const buildRequest = (kind = 'setup') => ({
  id: 'request-1',
  kind,
  status: 'pending',
  progress: {},
  resolution: null,
  revision: 'request-v5',
  credentialProvider: 'aws_assume_role',
  credentialName: 'AWS EC2 full access',
  serviceType: 'aws',
  markdown: 'Use an AWS role scoped to EC2.',
  expiresAt: '2030-01-01T00:00:00Z',
  createdAt: '2026-09-07T00:00:00Z',
  agent: {
    id: 'agent-1',
    name: 'Deploy Agent',
    harnessType: 'codex',
    team: null,
  },
  workflow: { id: 'workflow-1', name: 'Default' },
  connection: kind === 'credential_update' ? { id: 'connection-1', name: 'AWS production' } : null,
  credential: null,
})

const setPermissions = (permissions: Record<string, string[]>) => {
  const { mockActiveOrganisation } = jest.requireMock('@/contexts/organisationContext')
  mockActiveOrganisation.role.permissions = JSON.stringify({
    permissions,
    app_permissions: {},
    agent_permissions: { AgentWorkflows: ['update'] },
    global_access: false,
  })
}

describe('Agent request cards', () => {
  let container: HTMLDivElement
  let root: Root
  let resolveRequest: jest.Mock

  beforeEach(() => {
    setPermissions({
      AgentRequests: ['read', 'update'],
      IntegrationCredentials: ['read', 'create'],
      AgentConnections: ['create', 'update'],
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    resolveRequest = jest.fn().mockResolvedValue({ data: {} })
    ;(useMutation as jest.Mock).mockReturnValue([resolveRequest, { loading: false }])
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn().mockReturnValue({ matches: true }),
    })
    window.requestAnimationFrame = (callback) => {
      callback(0)
      return 1
    }
    window.cancelAnimationFrame = jest.fn()
    Element.prototype.scrollIntoView = jest.fn()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const renderRequest = async (kind = 'setup') => {
    ;(useQuery as jest.Mock).mockReturnValue({
      data: { agentRequests: [buildRequest(kind)] },
      loading: false,
      error: undefined,
      refetch: jest.fn().mockResolvedValue({}),
    })
    await act(async () => {
      root.render(
        <Suspense fallback={<div>Loading</div>}>
          <AgentRequestsPage params={Promise.resolve({ team: 'phase' })} />
        </Suspense>
      )
      await Promise.resolve()
    })
  }

  const renderWith = async (overrides: Record<string, unknown>) => {
    ;(useQuery as jest.Mock).mockReturnValue({
      data: { agentRequests: [{ ...buildRequest(), ...overrides }] },
      loading: false,
      error: undefined,
      refetch: jest.fn().mockResolvedValue({}),
    })
    await act(async () => {
      root.render(
        <Suspense fallback={<div>Loading</div>}>
          <AgentRequestsPage params={Promise.resolve({ team: 'phase' })} />
        </Suspense>
      )
      await Promise.resolve()
    })
  }

  const timing = () => {
    const field = Array.from(container.querySelectorAll('dt')).find((term) =>
      /Expires|Expired|Resolved/.test(term.textContent || '')
    )!
    return `${field.textContent} ${field.nextElementSibling!.textContent}`
  }

  test('shows when a pending request expires', async () => {
    await renderWith({ expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString() })

    expect(timing()).toBe('Expires in 3 days')
  })

  test('shows when a closed request was resolved, not when it would have expired', async () => {
    await renderWith({
      status: 'denied',
      resolvedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    })

    expect(timing()).toBe('Resolved 2 days ago')
  })

  test('shows when an expired request expired', async () => {
    await renderWith({
      status: 'expired',
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
      resolvedAt: new Date(Date.now() - 3_600_000).toISOString(),
    })

    expect(timing()).toBe('Expired yesterday')
  })

  test('keeps the last requests on screen when a poll fails', async () => {
    ;(useQuery as jest.Mock).mockReturnValue({
      data: { agentRequests: [buildRequest()] },
      loading: false,
      error: new Error('Network request failed'),
      refetch: jest.fn().mockResolvedValue({}),
    })
    await act(async () => {
      root.render(
        <Suspense fallback={<div>Loading</div>}>
          <AgentRequestsPage params={Promise.resolve({ team: 'phase' })} />
        </Suspense>
      )
      await Promise.resolve()
    })

    expect(container.textContent).toContain('AWS EC2 full access')
    expect(container.textContent).not.toContain('Network request failed')
  })

  test('offers only deny without permission to manage Agent Connections', async () => {
    setPermissions({
      AgentRequests: ['read', 'update'],
      IntegrationCredentials: ['read'],
    })
    await renderRequest()

    expect(container.textContent).toContain('Deny')
    expect(container.textContent).not.toContain('Set up Connection')
    expect(container.textContent).toContain('You can deny this request')
  })

  const click = async (label: string) =>
    act(async () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === label)!
        .click()
    )

  test('sends the reviewer note with a denial', async () => {
    await renderRequest()
    await click('Deny with note')

    expect(resolveRequest.mock.calls[0][0].variables.resolutionNote).toBe(
      'Use the read-only role instead.'
    )
  })

  test('opens a linked setup request once and scrolls to it once', async () => {
    await renderRequest()
    const card = () => container.querySelector<HTMLElement>('[data-request="request-1"]')!
    expect(card().dataset.autoOpen).toBe('true')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)

    await click('Auto-opened')
    ;(useQuery as jest.Mock).mockReturnValue({
      data: { agentRequests: [buildRequest(), { ...buildRequest(), id: 'request-2' }] },
      loading: false,
      error: undefined,
      refetch: jest.fn().mockResolvedValue({}),
    })
    await act(async () => {
      root.render(
        <Suspense fallback={<div>Loading</div>}>
          <AgentRequestsPage params={Promise.resolve({ team: 'phase' })} />
        </Suspense>
      )
      await Promise.resolve()
    })

    expect(card().dataset.autoOpen).toBe('false')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  test('allows setup with request, credential-read, Connection, and workflow permissions', async () => {
    await renderRequest()

    expect(container.textContent).toContain('Connection setup')
    expect(container.textContent).toContain('AWS EC2 full access')
    expect(container.textContent).toContain('Use an AWS role scoped to EC2.')
    expect(container.querySelector('[data-request="request-1"]')).toMatchObject({
      dataset: expect.objectContaining({ autoOpen: 'true' }),
    })
    expect(container.textContent).toContain('Set up Connection')
    expect(container.textContent).not.toMatch(/policy|app source|credential class/i)
  })

  test('denies with optimistic request revision and classifies credential updates', async () => {
    await renderRequest('credential_update')

    expect(container.textContent).toContain('Credential update')
    expect(container.textContent).toContain('Update credentials')
    await act(async () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Deny')!
        .click()
    )
    expect(resolveRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          requestId: 'request-1',
          expectedRevision: 'request-v5',
          approved: false,
          resolutionNote: 'Denied in the Phase Console.',
        },
      })
    )
  })
})
