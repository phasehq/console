import {
  blockedHostConnectionCandidate,
  blockedHostConnectionCandidates,
  agentConnectionUsesHTTP,
  agentEventAuthority,
  canAllowAgentConnectionHost,
  mergeAgentEventRows,
  type AgentEventRow,
  type AgentEventWorkflow,
} from '@/components/agents/AgentEventLogUtils'

const event = (ingestSeq: string, eventId: string, outcome = 'ok'): AgentEventRow => ({
  ingestSeq,
  eventId,
  proxyCreatedAt: '2026-07-12T00:00:00Z',
  ingestedAt: '2026-07-12T00:00:01Z',
  eventType: 'proxy_request',
  protocol: 'http',
  outcome,
})

describe('Agent event cursor window', () => {
  test('deduplicates rows, applies newer payloads, and keeps cursor order', () => {
    const merged = mergeAgentEventRows(
      [event('3', 'event-3'), event('1', 'event-1')],
      [event('2', 'event-2'), event('3', 'event-3', 'updated')]
    )

    expect(merged.map((row) => row.ingestSeq)).toEqual(['1', '2', '3'])
    expect(merged[2].outcome).toBe('updated')
  })

  test('compares insertion sequences without losing 64-bit precision', () => {
    const merged = mergeAgentEventRows(
      [],
      [event('9007199254740994', 'later'), event('9007199254740993', 'earlier')]
    )

    expect(merged.map((row) => row.eventId)).toEqual(['earlier', 'later'])
  })

  test('caps the visible window to the newest rows', () => {
    const merged = mergeAgentEventRows(
      [event('1', 'event-1'), event('2', 'event-2')],
      [event('3', 'event-3'), event('4', 'event-4')],
      2
    )

    expect(merged.map((row) => row.eventId)).toEqual(['event-3', 'event-4'])
  })
})

describe('blocked host actions', () => {
  const workflows: AgentEventWorkflow[] = [
    {
      id: 'workflow-1',
      name: 'Default',
      connections: [
        { id: 'connection-1', name: 'AWS', hostRulesVersion: 'version-1' },
        { id: 'connection-1', name: 'AWS', hostRulesVersion: 'version-1' },
      ],
    },
  ]
  const blockedHostEvent: AgentEventRow = {
    ...event('42', 'event-42', 'denied'),
    eventType: 'request',
    protocol: 'http',
    proxyDecision: 'BLOCK',
    reason: 'lockdown_unbound_host',
    host: 'ssmmessages.eu-central-1.amazonaws.com',
    port: 443,
    workflow: { id: 'workflow-1', name: 'Default' },
  }

  test('selects the only unique granted connection for an unbound host denial', () => {
    expect(blockedHostConnectionCandidate(blockedHostEvent, workflows)?.id).toBe('connection-1')
  })

  test('does not choose a connection when the workflow has multiple connections', () => {
    const withMultiple = [
      {
        ...workflows[0],
        connections: [
          ...workflows[0].connections,
          { id: 'connection-2', name: 'Other', hostRulesVersion: 'version-2' },
        ],
      },
    ]

    expect(blockedHostConnectionCandidate(blockedHostEvent, withMultiple)).toBeNull()
    expect(blockedHostConnectionCandidates(blockedHostEvent, withMultiple)).toHaveLength(2)
  })

  test.each([
    { reason: 'credential_swap_failed' },
    { proxyDecision: 'ALLOW' },
    { outcome: 'ok' },
    { protocol: 'postgres' },
    { port: null },
    { eventType: 'runtime' },
  ])('does not offer host changes for unrelated events: %o', (change) => {
    expect(blockedHostConnectionCandidates({ ...blockedHostEvent, ...change }, workflows)).toEqual(
      []
    )
  })

  test('does not treat an already-bound event as an unbound host denial', () => {
    expect(
      blockedHostConnectionCandidates(
        { ...blockedHostEvent, connection: { id: 'connection-1', name: 'AWS' } },
        workflows
      )
    ).toEqual([])
  })

  test('formats the exact destination authority, including IPv6', () => {
    expect(agentEventAuthority(blockedHostEvent)).toBe('ssmmessages.eu-central-1.amazonaws.com:443')
    expect(agentEventAuthority({ host: '2001:db8::1', port: 8443 })).toBe('[2001:db8::1]:8443')
  })

  test('fails closed until service templates confirm an HTTP connection', () => {
    expect(agentConnectionUsesHTTP('aws', new Set())).toBe(false)
    expect(agentConnectionUsesHTTP('AWS', new Set(['aws']))).toBe(true)
    expect(agentConnectionUsesHTTP('postgres', new Set(['aws']))).toBe(false)
  })

  test.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])(
    'requires both Agent update and Connection management permissions',
    (canUpdateAgent, canManageConnectionHosts, expected) => {
      expect(canAllowAgentConnectionHost(canUpdateAgent, canManageConnectionHosts)).toBe(expected)
    }
  )
})
