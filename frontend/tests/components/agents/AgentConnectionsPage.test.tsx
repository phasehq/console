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
  UpdateConnectionDialog: () => <button type="button">Edit</button>,
}))
jest.mock('@/components/agents/AgentDialogs', () => ({
  ConfirmAgentAction: ({
    actionLabel,
    triggerVariant,
    triggerProps,
  }: {
    actionLabel: string
    triggerVariant?: string
    triggerProps?: { icon?: { name: string } }
  }) => (
    <button type="button" data-variant={triggerVariant} data-icon={triggerProps?.icon?.name}>
      {actionLabel}
    </button>
  ),
}))
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('@/contexts/organisationContext', () => {
  const activeOrganisation = {
    id: 'org-1',
    name: 'acme',
    memberId: 'member-viewer',
    role: {
      permissions: JSON.stringify({
        permissions: {
          AgentConnections: ['read', 'update', 'delete'],
          IntegrationCredentials: ['read'],
        },
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

const connection = (
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id,
  name: id,
  serviceType: 'aws',
  state: 'active',
  authentication: { id: `${id}-keys`, name: `${id} keys`, provider: { id: 'aws', name: 'AWS' } },
  config: {},
  updatedAt: '2026-09-07T00:00:00Z',
  hostRulesAuthoredBy: null,
  hostRulesApprovedBy: null,
  hostRulesVersion: `${id}-version-1`,
  hostRulesApprovedVersion: '',
  ...overrides,
})

const override = (id: string, authorId: string, approved = false) =>
  connection(id, {
    config: { hosts: [{ match: 'exact', value: `${id}.storage.internal` }] },
    hostRulesAuthoredBy: { id: authorId },
    hostRulesApprovedBy: approved ? { id: 'member-approver' } : null,
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
          connection('built-in'),
          connection('analytics', {
            serviceType: 'postgres',
            config: { hosts: [{ match: 'exact', value: 'analytics.internal', port: 5432 }] },
            authentication: {
              id: 'analytics-keys',
              name: 'analytics keys',
              provider: { id: 'postgres', name: 'PostgreSQL' },
            },
          }),
          connection('pending', { state: 'pending_credentials', authentication: null }),
          connection('paused', { state: 'disabled' }),
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
          {
            serviceType: 'postgres',
            displayName: 'PostgreSQL',
            provider: 'postgres',
            hostRulesMode: 'required_endpoint',
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

  const row = (name: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('tbody[data-connection-row]')).find(
      (body) => body.querySelector('h3')?.textContent === name
    )!
  const cells = (name: string) => Array.from(row(name).querySelector('tr')!.children)
  const button = (scope: Element, label: string) =>
    Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
      (element) => element.textContent === label
    )

  test('lists Connections as table rows, like the other Agent lists', () => {
    expect(Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual([
      'Connection',
      'Integration credentials',
      'Endpoint',
      'Updated',
      'Actions',
    ])
    expect(container.querySelectorAll('tbody[data-connection-row]')).toHaveLength(7)

    const [identity, credential, endpoint, updated] = cells('built-in')
    // The service shows on the tile and under the name, as the harness does in the Agents list.
    expect(identity.querySelector('[role="img"][aria-label="AWS"]')).not.toBeNull()
    expect(identity.textContent).toBe('built-inAWS')
    const link = credential.querySelector('a')!
    expect(link.getAttribute('href')).toBe(
      '/acme/integrations?provider=aws&credential=built-in-keys'
    )
    expect(credential.textContent).toBe('built-in keysAWS')
    expect(endpoint.textContent).toBe('Built-in hosts')
    expect(updated.textContent).toMatch(/ago$/)
  })

  test('says once why a Connection is pending, and badges other inactive states', () => {
    const [identity, credential] = cells('pending')
    expect(credential.textContent).toBe('Credentials needed')
    expect(identity.textContent).toBe('pendingAWS')
    expect(cells('paused')[0].textContent).toBe('pausedDisabledAWS')
  })

  test('shows override hosts with their review state, and summarises Postgres endpoints', () => {
    expect(cells('approved')[2].textContent).toBe('approved.storage.internalApproved override')
    expect(cells('theirs')[2].textContent).toBe('theirs.storage.internalCustom host override')
    // Postgres hosts come from the credentials, so the list does not repeat them.
    expect(cells('analytics')[2].textContent).toBe('Configured endpoint')
  })

  test('puts a pending override review under its row, with the action on the right', () => {
    expect(row('approved').querySelectorAll('tr')).toHaveLength(1)
    expect(button(row('approved'), 'Approve reviewed version')).toBeUndefined()

    const mine = row('mine').querySelectorAll('tr')
    expect(mine).toHaveLength(2)
    expect(mine[1].textContent).toContain('Waiting for another authorized member to approve')
    expect(button(row('mine'), 'Approve reviewed version')).toBeUndefined()

    const approve = button(row('theirs'), 'Approve reviewed version')!
    expect(approve.parentElement!.lastElementChild).toBe(approve)
    expect(approve.parentElement!.firstElementChild!.textContent).toBe(
      'Needs independent reviewVersion theirs-v'
    )
  })

  test('shows Edit and a red Delete with the trash can on row hover, always on touch screens', () => {
    const body = row('approved')
    expect(body.classList).toContain('group')
    const remove = button(body, 'Delete')!
    expect(remove.dataset.variant).toBe('danger')
    expect(remove.dataset.icon).toBe('FaTrashAlt')
    const actions = remove.parentElement!
    expect(button(actions, 'Edit')).toBeDefined()
    expect(actions.className).toContain('[@media(hover:hover)]:group-hover:opacity-100')
    expect(actions.className).toContain('[@media(hover:hover)]:focus-within:opacity-100')
    // Hidden only where the pointer can hover; touch screens always show the buttons.
    expect(actions.className).toContain('[@media(hover:hover)]:opacity-0')
    expect(actions.classList).not.toContain('opacity-0')
  })
})
