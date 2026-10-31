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
  ConfirmAgentAction: ({ actionLabel }: { actionLabel: string }) => (
    <button type="button">{actionLabel}</button>
  ),
  CreateWorkflowDialog: () => <button type="button">stub-create-workflow</button>,
  DeleteAgentDialog: () => null,
  EditAgentDialog: () => null,
  EditWorkflowDialog: () => <button type="button">Edit</button>,
  GrantWorkflowDialog: () => <button type="button">Add Connection</button>,
  MintAgentTokenDialog: ({ workflows }: { workflows: Array<{ name: string }> }) => (
    <button type="button">stub-mint:{workflows.map(({ name }) => name).join(',')}</button>
  ),
}))
jest.mock('@/contexts/organisationContext', () => {
  const activeOrganisation = {
    id: 'org-1',
    memberId: 'member-1',
    role: {
      permissions: JSON.stringify({
        permissions: { Agents: ['read', 'update'], AgentConnections: ['read'] },
        app_permissions: {},
        agent_permissions: {
          AgentWorkflows: ['read', 'create', 'update', 'delete'],
          AgentTokens: ['create'],
        },
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

const mockDetail = (workflows: Array<ReturnType<typeof workflow>>) =>
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
                createdBy: { id: 'member-1', email: 'rohan@phase.dev', fullName: 'Rohan' },
                memberships: [],
                canManageMembers: true,
                tokens: [],
              },
            ],
            agentWorkflows: workflows,
            agentSessions: [],
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

  const render = async () => {
    await act(async () => {
      root.render(
        <Suspense fallback={<div>Loading</div>}>
          <AgentDetailPage
            params={Promise.resolve({ team: 'acme', agent: 'agent-1' })}
            searchParams={Promise.resolve({})}
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
})
