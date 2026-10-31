import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import AgentConnectionsPage from '@/app/[team]/agents/connections/page'

jest.mock('@/graphql/queries/agents/getAgentAssets.gql', () => ({
  GetAgentAssets: Symbol('GetAgentAssets'),
}))
jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({
  ApproveAgentConnectionHostRulesOp: Symbol('ApproveAgentConnectionHostRulesOp'),
  DeleteAgentConnectionOp: Symbol('DeleteAgentConnectionOp'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
jest.mock('@/components/agents/AgentConnectionDialogs', () => ({
  CreateConnectionDialog: () => null,
  UpdateConnectionDialog: () => null,
}))
jest.mock('@/components/agents/AgentDialogs', () => ({ ConfirmAgentAction: () => null }))
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('@/contexts/organisationContext', () => {
  const activeOrganisation = {
    id: 'org-1',
    name: 'acme',
    memberId: 'member-viewer',
    role: {
      permissions: JSON.stringify({
        permissions: { AgentConnections: ['read', 'update'], IntegrationCredentials: ['read'] },
        app_permissions: {},
        agent_permissions: {},
        global_access: false,
      }),
    },
  }
  return {
    organisationContext: jest
      .requireActual<typeof React>('react')
      .createContext({ activeOrganisation }),
  }
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const override = (id: string, authorId: string, approved = false): Record<string, unknown> => ({
  id,
  name: id,
  serviceType: 'aws',
  state: 'active',
  authentication: { id: `${id}-keys`, name: `${id} keys`, provider: { id: 'aws', name: 'AWS' } },
  config: { hosts: [{ match: 'exact', value: `${id}.storage.internal` }] },
  updatedAt: '2026-09-07T00:00:00Z',
  hostRulesAuthoredBy: { id: authorId },
  hostRulesApprovedBy: approved ? { id: 'member-approver' } : null,
  hostRulesVersion: `${id}-version-1`,
  hostRulesApprovedVersion: approved ? `${id}-version-1` : '',
})

describe('Agent Connections', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    ;(useMutation as jest.Mock).mockReturnValue([jest.fn(), { loading: false }])
    ;(useQuery as jest.Mock).mockReturnValue({
      data: {
        agentConnections: [
          override('approved', 'member-author', true),
          override('mine', 'member-viewer'),
          override('theirs', 'member-author'),
        ],
        agentServiceTemplates: [
          {
            serviceType: 'aws',
            displayName: 'AWS',
            provider: 'aws',
            hostRulesMode: 'optional_override',
          },
        ],
      },
      loading: false,
      error: undefined,
      refetch: jest.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<AgentConnectionsPage />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const card = (name: string) =>
    Array.from(container.querySelectorAll('article')).find((article) =>
      article.querySelector('h3')?.textContent?.includes(name)
    )!

  test('names the service on its tile instead of repeating it in a badge', () => {
    const header = card('approved').querySelector('h3')!.parentElement!.parentElement!
    expect(header.querySelector('[role="img"][aria-label="AWS"]')).not.toBeNull()
    expect(header.textContent).toBe('approvedActive')
  })

  test('puts each review state in the override panel, with the action on the right', () => {
    expect(card('approved').textContent).toContain('Approved for this exact version')
    expect(card('mine').textContent).toContain('Waiting for another authorized member to approve')
    expect(card('theirs').textContent).toContain('Needs independent review')

    const approveButtons = (name: string) =>
      Array.from(card(name).querySelectorAll('button')).filter(
        (button) => button.textContent === 'Approve reviewed version'
      )
    expect(approveButtons('approved')).toHaveLength(0)
    expect(approveButtons('mine')).toHaveLength(0)
    // The status and its action share one row: status first, action last.
    const [approve] = approveButtons('theirs')
    expect(approve.parentElement!.lastElementChild).toBe(approve)
    expect(approve.parentElement!.firstElementChild!.textContent).toBe('Needs independent review')
    // The footer does not repeat the review state.
    expect(card('theirs').querySelector('dl')!.textContent).not.toMatch(/review|approval/i)
  })
})
