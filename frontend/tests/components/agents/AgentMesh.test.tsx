import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AgentMesh, type AgentMeshPermissions } from '@/components/agents/AgentMesh'
import { buildMeshModel } from '@/components/agents/AgentMeshUtils'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

jest.mock('@/components/agents/AgentDialogs', () => ({
  CreateAgentDialog: () => <button type="button">stub-create-agent</button>,
  MintAgentTokenDialog: ({
    workflows,
    harnessType,
  }: {
    workflows: Array<{ id: string }>
    harnessType?: string
  }) => <button type="button">stub-mint-token:{workflows[0]?.id}:{harnessType}</button>,
}))
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

  const renderMesh = async (overrides: Partial<AgentMeshPermissions> = {}) => {
    await act(async () => {
      root.render(
        <AgentMesh
          organisationId="org-1"
          team="phase"
          model={model}
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
    expect(container.textContent).toContain('Pending requests (1)')
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

  test('permission-gates additive Agent and Connection actions', async () => {
    await renderMesh({ canCreateAgent: false, canCreateConnection: false })

    expect(container.textContent).not.toContain('stub-create-agent')
    expect(container.textContent).not.toContain('stub-create-connection')
    expect(container.textContent).toContain('stub-mint-token:workflow-1:CODEX')
  })
})
