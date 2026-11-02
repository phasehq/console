import React, { act, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import AgentDetailPage from '@/app/[team]/agents/[agent]/page'

jest.mock('@/graphql/queries/agents/getAgentDetail.gql', () => ({
  GetAgentDetail: Symbol('GetAgentDetail'),
}))
jest.mock('@/graphql/queries/agents/getAgentAssets.gql', () => ({
  GetAgentAssets: Symbol('GetAgentAssets'),
}))
jest.mock('@/graphql/mutations/agents/manageAgents.gql', () => ({
  DeleteAgentWorkflowOp: Symbol('DeleteAgentWorkflowOp'),
  RevokeAgentTokenOp: Symbol('RevokeAgentTokenOp'),
  RevokeAgentSessionOp: Symbol('RevokeAgentSessionOp'),
  RevokeAgentWorkflowGrantOp: Symbol('RevokeAgentWorkflowGrantOp'),
  UpdateAgentOp: Symbol('UpdateAgentOp'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useQuery: jest.fn(),
  useMutation: jest.fn(),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
jest.mock('@/components/agents/AgentEventLog', () => ({ AgentEventLog: () => null }))
jest.mock('@/components/agents/AgentMembers', () => ({ AgentMembers: () => null }))
jest.mock('@/components/agents/AgentDialogs', () => ({
  AgentHarnessDialog: ({ children }: { children: (open: () => void) => React.ReactNode }) =>
    children(() => {}),
  AgentNameField: ({ agent }: { agent: { name: string } }) => <h2>{agent.name}</h2>,
  ConfirmAgentAction: ({
    actionLabel,
    triggerVariant,
  }: {
    actionLabel: string
    triggerVariant?: string
  }) => (
    <button type="button" data-variant={triggerVariant}>
      {actionLabel}
    </button>
  ),
  CreateWorkflowDialog: () => <button type="button">stub-create-workflow</button>,
  DeleteAgentDialog: () => <button type="button">stub-delete-agent</button>,
  EditWorkflowDialog: () => <button type="button">Edit</button>,
  GrantWorkflowDialog: () => <button type="button">Add Connection</button>,
  MintAgentTokenDialog: ({ workflows }: { workflows: Array<{ name: string }> }) => (
    <button type="button">stub-mint:{workflows.map(({ name }) => name).join(',')}</button>
  ),
}))
const rolePermissions = (permissions: Record<string, string[]>) =>
  JSON.stringify({
    permissions: { Agents: ['read', 'update'], AgentConnections: ['read'], ...permissions },
    app_permissions: {},
    agent_permissions: {
      AgentWorkflows: ['read', 'create', 'update', 'delete'],
      AgentTokens: ['create', 'read', 'delete'],
      AgentSessions: ['read', 'delete'],
    },
    global_access: false,
  })
jest.mock('@/contexts/organisationContext', () => {
  const activeOrganisation = { id: 'org-1', memberId: 'member-1', role: { permissions: '' } }
  return {
    mockActiveOrganisation: activeOrganisation,
    organisationContext: jest
      .requireActual<typeof React>('react')
      .createContext({ activeOrganisation }),
  }
})
const setPermissions = (permissions: Record<string, string[]> = {}) => {
  jest.requireMock('@/contexts/organisationContext').mockActiveOrganisation.role.permissions =
    rolePermissions(permissions)
}
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
// Headless UI checks for running animations, which jsdom does not implement.
Object.defineProperty(Element.prototype, 'getAnimations', {
  configurable: true,
  value: () => [],
})

const connection = (id: string, name: string, credential: string, provider: string) => ({
  id,
  name,
  serviceType: 'aws',
  state: 'active',
  hostRulesVersion: '1',
  authentication: {
    id: `${id}-credential`,
    name: credential,
    provider: { id: provider, name: provider },
  },
})

const staging = connection('staging', 'AWS staging', 'AWS staging keys', 'AWS')
const production = connection('production', 'AWS production', 'Deploy role', 'AWS Assume Role')

const workflow = (
  id: string,
  name: string,
  createdAt: string,
  grants: Array<ReturnType<typeof connection>>
) => ({
  id,
  name,
  createdAt,
  grants: grants.map((granted) => ({ id: `${id}-${granted.id}`, connection: granted })),
})

const pendingRequest = (
  id: string,
  workflowId: string,
  kind: string,
  connection: { id: string; name: string } | null,
  hoursLeft: number
) => ({
  id,
  kind,
  status: 'PENDING',
  serviceType: 'aws',
  credentialProvider: 'aws',
  credentialName: 'Billing exports',
  createdAt: '2026-09-07T00:00:00Z',
  expiresAt: new Date(Date.now() + hoursLeft * 3_600_000).toISOString(),
  agent: { id: 'agent-1' },
  workflow: { id: workflowId, name: workflowId },
  connection,
})

const mockDetail = (
  workflows: Array<ReturnType<typeof workflow>>,
  agentRequests: Array<ReturnType<typeof pendingRequest>> = [],
  tokens: Array<Record<string, unknown>> = [],
  agentSessions: Array<Record<string, unknown>> = []
) =>
  (useQuery as jest.Mock).mockImplementation((_query, options) =>
    options?.variables?.agentId
      ? {
          data: {
            agents: [
              {
                id: 'agent-1',
                name: 'platform-ops',
                harnessType: 'CLAUDE_CODE',
                status: 'ACTIVE',
                lastSeenAt: null,
                createdAt: '2026-09-01T00:00:00Z',
                createdBy: { id: 'member-1', email: 'rohan@phase.dev', fullName: 'Rohan' },
                memberships: [],
                canManageMembers: true,
                tokens,
              },
            ],
            agentWorkflows: workflows,
            agentSessions,
            agentRequests,
          },
          loading: false,
          error: undefined,
          refetch: jest.fn(),
        }
      : { data: { agentConnections: [staging, production], agentServiceTemplates: [] } }
  )

describe('Agent Workflows tab', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setPermissions()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    ;(useMutation as jest.Mock).mockReturnValue([jest.fn(), { loading: false }])
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const render = async (tab?: string) => {
    await act(async () => {
      root.render(
        <Suspense fallback={<div>Loading</div>}>
          <AgentDetailPage
            params={Promise.resolve({ team: 'acme', agent: 'agent-1' })}
            searchParams={Promise.resolve(tab ? { tab } : {})}
          />
        </Suspense>
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const section = (name: string) =>
    container.querySelector<HTMLElement>(`section[aria-label="${name} Workflow"]`)!

  test('lists Workflows Default first, one line per granted Connection', async () => {
    mockDetail([
      workflow('incident-response', 'Incident response', '2026-09-03T00:00:00Z', [
        production,
        staging,
      ]),
      workflow('default-workflow', 'Default', '2026-09-01T00:00:00Z', [staging]),
      workflow('cost-reports', 'Cost reports', '2026-09-02T00:00:00Z', []),
    ])

    await render()

    const sections = Array.from(container.querySelectorAll('section[aria-label$=" Workflow"]'))
    expect(sections.map((element) => element.getAttribute('aria-label'))).toEqual([
      'Default Workflow',
      'Cost reports Workflow',
      'Incident response Workflow',
    ])
    // The token dialog offers the same order, so it opens on Default.
    expect(container.textContent).toContain('stub-mint:Default,Cost reports,Incident response')

    const defaultRows = section('Default').querySelectorAll('li')
    expect(defaultRows).toHaveLength(1)
    expect(defaultRows[0].textContent).toBe('AWS stagingAWS staging keys · AWSActiveRevoke')
    expect(section('Default').textContent).toContain('default-')
    expect(section('Incident response').querySelectorAll('li')).toHaveLength(2)

    // A Workflow without grants offers the setup prompt inline; the full panel is for first runs.
    expect(section('Cost reports').textContent).toContain('No Connections granted')
    expect(section('Cost reports').textContent).toContain('Copy setup prompt')
    expect(container.textContent).not.toContain('Try this in your Agent')
  })

  test('shows the setup prompt panel once while no Workflow has a Connection', async () => {
    mockDetail([
      workflow('default-workflow', 'Default', '2026-09-01T00:00:00Z', []),
      workflow('releases', 'Releases', '2026-09-02T00:00:00Z', []),
    ])

    await render()

    expect(container.textContent?.match(/Try this in your Agent/g)).toHaveLength(1)
    expect(container.textContent).not.toContain('Copy setup prompt')
  })

  test('lists each pending request in its Workflow, above the grants', async () => {
    setPermissions({ AgentRequests: ['read'] })
    mockDetail(
      [
        workflow('default-workflow', 'Default', '2026-09-01T00:00:00Z', [staging]),
        workflow('cost-reports', 'Cost reports', '2026-09-02T00:00:00Z', []),
      ],
      [
        pendingRequest('setup-1', 'cost-reports', 'CONNECTION_SETUP', null, 72),
        pendingRequest('update-1', 'default-workflow', 'CREDENTIAL_UPDATE', staging, 5),
      ]
    )

    await render()

    const detailQuery = (useQuery as jest.Mock).mock.calls.find(
      ([, options]) => options?.variables?.agentId
    )!
    expect(detailQuery[1].variables).toMatchObject({ includeRequests: true })

    const defaultRows = section('Default').querySelectorAll('li')
    expect(defaultRows).toHaveLength(2)
    expect(defaultRows[0].textContent).toContain('AWS staging')
    expect(defaultRows[0].textContent).toContain('Credential update · Expires in 5 hours')
    expect(defaultRows[0].textContent).toContain('Pending')
    expect(defaultRows[0].querySelector('a')!.getAttribute('href')).toBe(
      '/acme/agents/requests?request=update-1'
    )
    expect(defaultRows[1].textContent).toContain('Revoke')

    // A Workflow waiting on its first Connection shows the request, not the empty note.
    const costRows = section('Cost reports').querySelectorAll('li')
    expect(costRows).toHaveLength(1)
    expect(costRows[0].textContent).toContain('Connection setup · Expires in 3 days')
    expect(section('Cost reports').textContent).not.toContain('No Connections granted')

    expect(container.querySelector('[role="tab"]')!.textContent).toBe('Workflows 22 pending')
  })

  test('shows requests to members who cannot see Connection details', async () => {
    setPermissions({ AgentRequests: ['read'], AgentConnections: [] })
    mockDetail(
      [workflow('default-workflow', 'Default', '2026-09-01T00:00:00Z', [staging])],
      [pendingRequest('update-1', 'default-workflow', 'CREDENTIAL_UPDATE', staging, 30)]
    )

    await render()

    const rows = section('Default').querySelectorAll('li')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Credential update')
    expect(section('Default').textContent).toContain(
      'Connection metadata is restricted for your role.'
    )
    expect(section('Default').textContent).not.toContain('Revoke')
  })

  test('skips requests for members who cannot read them', async () => {
    mockDetail([workflow('default-workflow', 'Default', '2026-09-01T00:00:00Z', [staging])])

    await render()

    const detailQuery = (useQuery as jest.Mock).mock.calls.find(
      ([, options]) => options?.variables?.agentId
    )!
    expect(detailQuery[1].variables).toMatchObject({ includeRequests: false })
    expect(container.querySelector('[role="tab"]')!.textContent).toBe('Workflows 1')
  })

  test('offers Generate token once, beside the tabs, on every tab', async () => {
    mockDetail(
      [workflow('default-workflow', 'Default', '2026-09-01T00:00:00Z', [staging])],
      [],
      [
        {
          id: 'token-1',
          name: 'ops-runner',
          createdAt: '2026-09-02T00:00:00Z',
          expiresAt: null,
          lastUsedAt: null,
          workflow: { id: 'default-workflow', name: 'Default' },
        },
      ]
    )

    for (const tab of [undefined, 'tokens']) {
      await render(tab)
      expect(container.textContent?.match(/stub-mint/g)).toHaveLength(1)
    }
    expect(container.textContent).toContain('Each token logs the Phase CLI into one Workflow.')
  })

  test('token rows show a red Revoke on hover, as other token lists do', async () => {
    mockDetail(
      [workflow('default-workflow', 'Default', '2026-09-01T00:00:00Z', [staging])],
      [],
      [
        {
          id: 'token-1',
          name: 'ops-runner',
          createdAt: '2026-09-02T00:00:00Z',
          expiresAt: null,
          lastUsedAt: null,
          workflow: { id: 'default-workflow', name: 'Default' },
        },
      ]
    )

    await render('tokens')

    const row = Array.from(container.querySelectorAll('tbody tr')).find((element) =>
      element.textContent?.includes('ops-runner')
    )!
    const revoke = Array.from(row.querySelectorAll('button')).find(
      (button) => button.textContent === 'Revoke'
    )!
    expect(revoke.dataset.variant).toBe('danger')
    expect(row.classList).toContain('group')
    expect(revoke.parentElement!.className).toContain('opacity-0')
    expect(revoke.parentElement!.className).toContain('group-hover:opacity-100')
  })

  test('active session rows show a red Revoke on hover too', async () => {
    mockDetail(
      [workflow('default-workflow', 'Default', '2026-09-01T00:00:00Z', [staging])],
      [],
      [],
      [
        {
          id: 'session-1',
          sessionUid: 'sess_0123456789abcdef',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          revokedAt: null,
          harnessLabel: 'Claude Code',
          lastSeenAt: '2026-09-07T00:00:00Z',
          workflow: { id: 'default-workflow', name: 'Default' },
        },
      ]
    )

    await render('sessions')

    const row = Array.from(container.querySelectorAll('tbody tr')).find((element) =>
      element.textContent?.includes('sess_0123456')
    )!
    const revoke = Array.from(row.querySelectorAll('button')).find(
      (button) => button.textContent === 'Revoke'
    )!
    expect(revoke.dataset.variant).toBe('danger')
    expect(row.classList).toContain('group')
    expect(revoke.parentElement!.className).toContain('group-hover:opacity-100')
  })

  test('Workflow cards show their buttons on hover, with a red Delete and Revoke', async () => {
    mockDetail([
      workflow('default-workflow', 'Default', '2026-09-01T00:00:00Z', [staging]),
      workflow('releases', 'Releases', '2026-09-02T00:00:00Z', [production]),
    ])

    await render()

    const card = section('Releases')
    const button = (scope: Element, label: string) =>
      Array.from(scope.querySelectorAll('button')).find((element) => element.textContent === label)!
    expect(card.classList).toContain('group/workflow')
    const remove = button(card, 'Delete')
    expect(remove.dataset.variant).toBe('danger')
    expect(remove.parentElement!.className).toContain('group-hover/workflow:opacity-100')
    expect(button(card, 'Add Connection').parentElement).toBe(remove.parentElement)

    const grant = card.querySelector('li')!
    const revoke = button(grant, 'Revoke')
    expect(revoke.dataset.variant).toBe('danger')
    expect(grant.classList).toContain('group/grant')
    expect(revoke.parentElement!.className).toContain('group-hover/grant:opacity-100')
  })

  test('keeps Disable and Delete in the danger zone, not the header', async () => {
    setPermissions({ Agents: ['read', 'update', 'delete'] })
    mockDetail([workflow('default-workflow', 'Default', '2026-09-01T00:00:00Z', [staging])])

    await render()

    const danger = container.querySelector<HTMLElement>('section[aria-label="Danger Zone"]')!
    expect(danger.textContent).toContain('Disable Agent')
    expect(danger.textContent).toContain('stub-delete-agent')
    expect(container.textContent?.match(/stub-delete-agent/g)).toHaveLength(1)
    // The stat cards are gone; the header carries the metadata instead.
    expect(container.textContent).not.toContain('Connections granted')
    expect(container.textContent).toContain('by Rohan')
    expect(container.textContent).toContain('Never seen')
  })
})
