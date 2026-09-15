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
jest.mock('@/contexts/organisationContext', () => ({
  organisationContext: jest.requireActual<typeof React>('react').createContext({
    activeOrganisation: {
      id: 'org-1',
      memberId: 'member-1',
      role: {
        permissions: JSON.stringify({
          permissions: {
            AgentRequests: ['read', 'update'],
            AgentWorkflows: ['update'],
            IntegrationCredentials: ['read', 'create'],
            Agents: ['update'],
          },
          app_permissions: {},
          global_access: false,
        }),
      },
    },
  }),
}))
jest.mock('@/components/agents/AgentDialogs', () => ({
  ConfirmAgentAction: ({ actionLabel, onConfirm }: any) => (
    <button type="button" onClick={onConfirm}>
      {actionLabel}
    </button>
  ),
}))
jest.mock('@/components/agents/AgentSetupRequestDialog', () => ({
  AgentSetupRequestDialog: ({ request, autoOpen }: any) => (
    <button type="button" data-request={request.id} data-auto-open={String(autoOpen)}>
      {request.kind.toLowerCase() === 'credential_update'
        ? 'Update credentials'
        : 'Set up Connection'}
    </button>
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

describe('Agent request cards', () => {
  let container: HTMLDivElement
  let root: Root
  let resolveRequest: jest.Mock

  beforeEach(() => {
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

  test('allows setup with request, credential-read, Agent, and workflow permissions', async () => {
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
