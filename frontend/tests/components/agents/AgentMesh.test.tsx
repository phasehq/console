import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AgentMesh, type AgentMeshPermissions } from '@/components/agents/AgentMesh'
import { buildMeshModel, type MeshModel } from '@/components/agents/AgentMeshUtils'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

jest.mock('@/components/agents/AgentDialogs', () => ({
  CreateAgentDialog: ({ onCreated }: { onCreated?: (agentId: string) => void }) => (
    <button type="button" onClick={() => onCreated?.('agent-9')}>
      stub-create-agent
    </button>
  ),
  MintAgentTokenDialog: ({
    workflows,
    harnessType,
  }: {
    workflows: Array<{ id: string }>
    harnessType?: string
  }) => (
    <button type="button">
      stub-mint-token:{workflows[0]?.id}:{harnessType}
    </button>
  ),
}))
const mockPush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('@/components/agents/AgentConnectionDialogs', () => ({
  CreateConnectionDialog: () => <button type="button">stub-create-connection</button>,
}))

const permissions: AgentMeshPermissions = {
  canCreateAgent: true,
  canReadConnections: true,
  canCreateConnection: true,
}

const model = buildMeshModel({
  agents: [
    {
      id: 'agent-1',
      name: 'Deploy bot',
      harnessType: 'CODEX',
      status: 'ACTIVE',
      lastSeenAt: null,
      activeSessionCount: 2,
      canMintToken: true,
    },
  ],
  workflows: [
    {
      id: 'workflow-1',
      name: 'Deploy',
      agentId: 'agent-1',
      grants: [
        {
          id: 'grant-1',
          connection: {
            id: 'connection-1',
            name: 'AWS production',
            serviceType: 'aws',
            state: 'active',
            authentication: {
              id: 'credential-1',
              name: 'EC2 deployer',
              provider: { id: 'aws', name: 'AWS' },
            },
          },
        },
      ],
    },
  ],
  requests: [
    {
      id: 'request-1',
      kind: 'credential_update',
      status: 'pending',
      credentialProvider: 'aws',
      credentialName: 'EC2 deployer',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (2 * 60 + 5) * 60_000).toISOString(),
      agent: { id: 'agent-1', name: 'Deploy bot' },
      workflow: { id: 'workflow-1', name: 'Deploy' },
    },
  ],
})

describe('AgentMesh', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const renderMesh = async (
    overrides: Partial<AgentMeshPermissions> = {},
    meshModel: MeshModel = model
  ) => {
    await act(async () => {
      root.render(
        <AgentMesh
          organisationId="org-1"
          team="phase"
          model={meshModel}
          services={[{ serviceType: 'aws', displayName: 'AWS', provider: 'aws' }]}
          permissions={{ ...permissions, ...overrides }}
          onGraphChange={() => {}}
        />
      )
    })
  }

  test('renders the grant graph with integration credential context and request links', async () => {
    await renderMesh()

    expect(container.textContent).toContain('Deploy bot')
    expect(container.textContent).toContain('AWS production')
    expect(container.textContent).toContain('Integration credentials')
    expect(container.textContent).toContain('EC2 deployer')
    expect(container.textContent).toContain('1 pending request')
    expect(container.textContent).toContain('Credential update · Expires in 2 hours')
    expect(container.textContent).not.toContain('Policy')
    expect(container.textContent?.match(/stub-mint-token/g)).toHaveLength(1)
    expect(container.textContent).toContain('stub-mint-token:workflow-1:CODEX')
    expect(container.querySelector('[data-mesh-node="agent:agent-1"]')).not.toBeNull()
    expect(container.querySelector('[data-mesh-node="connection:connection-1"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-mesh-edges] > g > path')).toHaveLength(1)
    expect(
      container.querySelector('a[href="/phase/agents/requests?request=request-1"]')
    ).not.toBeNull()
  })

  test('lists Workflows one per line with a single token action per Agent', async () => {
    const connection = { id: 'connection-1', name: 'AWS production', serviceType: 'aws' }
    const agentInput = (id: string, name: string) => ({
      id,
      name,
      harnessType: 'CODEX',
      status: 'ACTIVE',
      activeSessionCount: 0,
      canMintToken: true,
    })
    await renderMesh(
      {},
      buildMeshModel({
        agents: [agentInput('agent-1', 'Deploy bot'), agentInput('agent-2', 'Audit bot')],
        workflows: [
          {
            id: 'releases',
            name: 'Releases',
            agentId: 'agent-1',
            createdAt: '2026-09-02T00:00:00Z',
            grants: [{ connection }],
          },
          {
            id: 'default',
            name: 'Default',
            agentId: 'agent-1',
            createdAt: '2026-09-01T00:00:00Z',
            grants: [],
          },
          { id: 'audit', name: 'Audit', agentId: 'agent-2', grants: [{ connection }] },
        ],
      })
    )

    const card = container.querySelector('[data-mesh-node="agent:agent-1"]')!
    const rows = Array.from(card.querySelectorAll('[data-mesh-node^="workflow:"]'))
    expect(rows.map((row) => row.textContent)).toEqual(['DefaultNo grants', 'Releases1 grant'])
    // One token dialog per card, opening on the default Workflow.
    expect(card.textContent?.match(/stub-mint-token/g)).toHaveLength(1)
    expect(card.textContent).toContain('stub-mint-token:default:CODEX')

    // Hovering a Workflow dims its siblings and the other Agent's connector.
    await act(async () => {
      rows[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(rows[0].className).toContain('opacity-30')
    expect(rows[1].className).not.toContain('opacity-30')
    const edgeOpacity = Array.from(container.querySelectorAll('[data-mesh-edges] > g')).map(
      (edge) => (edge.getAttribute('class')?.includes('opacity-80') ? 'lit' : 'dimmed')
    )
    expect(edgeOpacity.sort()).toEqual(['dimmed', 'lit'])
  })

  test('the pending alert filters the canvas to Agents with pending requests', async () => {
    const agentInput = (id: string, name: string) => ({
      id,
      name,
      harnessType: 'CODEX',
      status: 'ACTIVE',
      activeSessionCount: 0,
      canMintToken: false,
    })
    const connection = (id: string) => ({ id, name: id, serviceType: 'aws' })
    await renderMesh(
      {},
      buildMeshModel({
        agents: [agentInput('agent-1', 'Deploy bot'), agentInput('agent-2', 'Audit bot')],
        workflows: [
          {
            id: 'deploy',
            name: 'Deploy',
            agentId: 'agent-1',
            grants: [{ connection: connection('aws') }],
          },
          {
            id: 'audit',
            name: 'Audit',
            agentId: 'agent-2',
            grants: [{ connection: connection('logs') }],
          },
        ],
        requests: [
          {
            id: 'request-1',
            kind: 'setup',
            status: 'pending',
            createdAt: new Date().toISOString(),
            agent: { id: 'agent-1' },
            workflow: { id: 'deploy', name: 'Deploy' },
          },
        ],
      })
    )

    const toggle = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '1 pending request'
    )!
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    const cards = () =>
      Array.from(
        container.querySelectorAll('[data-mesh-node^="agent:"], [data-mesh-node^="connection:"]')
      )
        .map((card) => card.getAttribute('data-mesh-node'))
        .sort()
    const counts = () =>
      Array.from(container.querySelectorAll('[data-mesh-column] h3')).map(
        (heading) => heading.textContent
      )

    await act(async () => toggle.click())

    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.textContent).toBe('Pending requests only 1')
    expect(cards()).toEqual(['agent:agent-1', 'connection:aws'])
    expect(counts()).toEqual(['Agents1/2', 'Connections1/2'])

    await act(async () => toggle.click())

    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(cards()).toEqual(['agent:agent-1', 'agent:agent-2', 'connection:aws', 'connection:logs'])
    expect(counts()).toEqual(['Agents2', 'Connections2'])
  })

  test('opens the new Agent after creation', async () => {
    await renderMesh()

    await act(async () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'stub-create-agent')!
        .click()
    )

    expect(mockPush).toHaveBeenCalledWith('/phase/agents/agent-9')
  })

  test('permission-gates additive Agent and Connection actions', async () => {
    await renderMesh({ canCreateAgent: false, canCreateConnection: false })

    expect(container.textContent).not.toContain('stub-create-agent')
    expect(container.textContent).not.toContain('stub-create-connection')
    expect(container.textContent).toContain('stub-mint-token:workflow-1:CODEX')
  })
})
