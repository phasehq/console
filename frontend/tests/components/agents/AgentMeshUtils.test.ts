import {
  buildMeshModel,
  filterMeshModel,
  meshEdgePath,
  meshFocusKeys,
  meshNodeKey,
  meshPendingRequestCount,
  pendingMeshModel,
  meshRelativeAge,
  meshRequestTargetLabel,
} from '@/components/agents/AgentMeshUtils'

const deployBot = {
  id: 'agent-1',
  name: 'Deploy bot',
  harnessType: 'CODEX',
  status: 'ACTIVE',
  activeSessionCount: 0,
  canMintToken: true,
}

const workflowInput = (
  id: string,
  name: string,
  agentId: string,
  createdAt: string | null = null,
  connectionIds: string[] = []
) => ({
  id,
  name,
  agentId,
  createdAt,
  grants: connectionIds.map((connectionId) => ({
    connection: { id: connectionId, name: connectionId, serviceType: 'aws' },
  })),
})

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

  test("puts the Agent's first Workflow first, then the rest A–Z", () => {
    const ordered = buildMeshModel({
      agents: [deployBot],
      workflows: [
        workflowInput('billing', 'Billing', 'agent-1', '2026-09-02T00:00:00Z'),
        workflowInput('default', 'Default', 'agent-1', '2026-09-01T00:00:00Z'),
        workflowInput('audits', 'audits', 'agent-1', '2026-09-03T00:00:00Z'),
      ],
    })

    expect(ordered.agents[0].workflows.map(({ name }) => name)).toEqual([
      'Default',
      'audits',
      'Billing',
    ])
  })

  test('lists the pending request closest to expiring first', () => {
    const request = (id: string, createdAt: string, expiresAt: string | null) => ({
      id,
      kind: 'setup',
      status: 'pending',
      createdAt,
      expiresAt,
      agent: { id: 'agent-1' },
      workflow: { id: 'workflow-1', name: 'Deploy' },
    })
    const withRequests = buildMeshModel({
      agents: [deployBot],
      workflows: [],
      requests: [
        request('later', '2026-09-07T05:00:00Z', '2026-09-10T00:00:00Z'),
        request('no-deadline', '2026-09-07T06:00:00Z', null),
        request('sooner', '2026-09-07T01:00:00Z', '2026-09-07T08:00:00Z'),
      ],
    })

    expect(withRequests.agents[0].pendingRequests.map(({ id }) => id)).toEqual([
      'sooner',
      'later',
      'no-deadline',
    ])
  })
})

describe('Agent mesh focus', () => {
  // Deploy bot and Audit bot share the AWS Connection; only Deploy bot uses the database.
  const shared = buildMeshModel({
    agents: [deployBot, { ...deployBot, id: 'agent-2', name: 'Audit bot' }],
    workflows: [
      workflowInput('deploy', 'Deploy', 'agent-1', null, ['aws']),
      workflowInput('reports', 'Reports', 'agent-1', null, ['database']),
      workflowInput('audit', 'Audit', 'agent-2', null, ['aws']),
    ],
  })
  const focus = (key: string) => [...meshFocusKeys(shared, key)].sort()

  test('an Agent lights its Workflows and their Connections, not Agents sharing them', () => {
    expect(focus(meshNodeKey.agent('agent-1'))).toEqual([
      'agent:agent-1',
      'connection:aws',
      'connection:database',
      'workflow:deploy',
      'workflow:reports',
    ])
  })

  test('a Workflow lights its Agent and Connections, not sibling Workflows', () => {
    expect(focus(meshNodeKey.workflow('deploy'))).toEqual([
      'agent:agent-1',
      'connection:aws',
      'workflow:deploy',
    ])
  })

  test('a Connection lights the Workflows granted it and their Agents', () => {
    expect(focus(meshNodeKey.connection('aws'))).toEqual([
      'agent:agent-1',
      'agent:agent-2',
      'connection:aws',
      'workflow:audit',
      'workflow:deploy',
    ])
  })
})

describe('Agent mesh pending filter', () => {
  const pendingRequest = (id: string, agentId: string) => ({
    id,
    kind: 'setup',
    status: 'pending',
    createdAt: '2026-09-07T00:00:00Z',
    agent: { id: agentId },
    workflow: { id: 'deploy', name: 'Deploy' },
  })
  const withRequests = buildMeshModel({
    agents: [deployBot, { ...deployBot, id: 'agent-2', name: 'Audit bot' }],
    workflows: [
      workflowInput('deploy', 'Deploy', 'agent-1', null, ['aws']),
      workflowInput('reports', 'Reports', 'agent-1', null, ['database']),
      workflowInput('audit', 'Audit', 'agent-2', null, ['aws', 'warehouse']),
    ],
    connections: [
      { id: 'idle', name: 'idle', serviceType: 'aws' },
      { id: 'warehouse', name: 'warehouse', serviceType: 'aws' },
    ],
    requests: [pendingRequest('request-1', 'agent-1'), pendingRequest('request-2', 'agent-1')],
  })

  test('counts pending requests across Agents', () => {
    expect(meshPendingRequestCount(withRequests)).toBe(2)
  })

  test('keeps only Agents with pending requests and the Connections they use', () => {
    const pending = pendingMeshModel(withRequests)

    expect(pending.agents.map(({ id }) => id)).toEqual(['agent-1'])
    expect(pending.connections.map(({ id }) => id).sort()).toEqual(['aws', 'database'])
    expect(pending.edges.map(({ fromKey }) => fromKey).sort()).toEqual([
      'workflow:deploy',
      'workflow:reports',
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
