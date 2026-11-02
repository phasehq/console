import {
  buildMeshModel,
  filterMeshModel,
  meshChainKeys,
  meshEdgePath,
  meshNodeKey,
  meshRelativeAge,
  meshRequestTargetLabel,
} from '@/components/agents/AgentMeshUtils'

const model = buildMeshModel({
  agents: [
    {
      id: 'agent-1',
      name: 'Deploy bot',
      harnessType: 'CODEX',
      status: 'ACTIVE',
      activeSessionCount: 1,
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
      credentialProvider: 'aws_assume_role',
      credentialName: 'EC2 deployer',
      createdAt: '2026-09-07T00:00:00Z',
      agent: { id: 'agent-1', name: 'Deploy bot' },
      workflow: { id: 'workflow-1', name: 'Deploy' },
    },
  ],
})

describe('Agent mesh model', () => {
  test('builds one credential-backed grant edge and a pending request chip', () => {
    expect(model.edges).toEqual([
      expect.objectContaining({
        fromKey: 'workflow:workflow-1',
        toKey: 'connection:connection-1',
        kind: 'grant',
      }),
    ])
    expect(model.connections[0]).toEqual(
      expect.objectContaining({
        name: 'AWS production',
        state: 'active',
        authentication: expect.objectContaining({ name: 'EC2 deployer' }),
        workflowCount: 1,
      })
    )
    expect(model.agents[0].pendingRequests[0]).toEqual(
      expect.objectContaining({ kind: 'CREDENTIAL_UPDATE', targetLabel: 'EC2 deployer' })
    )
  })

  test('filters by integration credentials without inventing additional nodes', () => {
    const filtered = filterMeshModel(
      {
        ...model,
        agents: model.agents.map((agent) => ({ ...agent, pendingRequests: [] })),
      },
      'ec2 deployer'
    )
    expect(filtered.agents).toHaveLength(0)
    expect(filtered.connections.map(({ id }) => id)).toEqual(['connection-1'])
    expect(filtered.edges).toHaveLength(0)
  })

  test('walks the complete Agent, workflow, and Connection chain', () => {
    expect([...meshChainKeys(model, meshNodeKey.agent('agent-1'))].sort()).toEqual([
      'agent:agent-1',
      'connection:connection-1',
      'workflow:workflow-1',
    ])
  })
})

describe('Agent mesh presentation helpers', () => {
  test('uses request credential context as the target label', () => {
    expect(
      meshRequestTargetLabel({
        id: 'request-1',
        kind: 'setup',
        status: 'pending',
        credentialName: 'S3 read only',
        createdAt: '2026-09-07T00:00:00Z',
        agent: { id: 'agent-1', name: 'Deploy bot' },
      })
    ).toBe('S3 read only')
  })

  test('formats age and bezier paths deterministically', () => {
    expect(meshRelativeAge('2026-09-07T00:00:00Z', Date.parse('2026-09-07T01:00:00Z'))).toBe(
      '1h ago'
    )
    expect(meshEdgePath({ x: 0, y: 10 }, { x: 100, y: 30 })).toBe('M 0 10 C 48 10, 52 30, 100 30')
  })
})
