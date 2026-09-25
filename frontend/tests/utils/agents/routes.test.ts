import {
  activeAgentTab,
  agentRequestSetupPath,
  agentsPath,
  type AgentTabSegment,
} from '@/utils/agents/routes'

describe('Agent routes', () => {
  test.each([
    ['/phase/agents', ''],
    ['/phase/agents/', ''],
    ['/phase/agents/all', 'all'],
    ['/phase/agents/all/', 'all'],
    ['/phase/agents/connections', 'connections'],
    ['/phase/agents/connections/connection-id', 'connections'],
    ['/phase/agents/requests/request-id', 'requests'],
    ['/agents/agents/connections', 'connections'],
  ] as Array<[string, AgentTabSegment]>)('%s selects the %s tab', (pathname, expected) => {
    expect(activeAgentTab(pathname)).toBe(expected)
  })

  it('keeps Agent detail pages and legacy stubs on the Agents directory tab', () => {
    expect(activeAgentTab('/phase/agents/agent-id')).toBe('all')
    expect(activeAgentTab('/phase/agents/agent-id/workflows')).toBe('all')
    expect(activeAgentTab('/phase/agents/secrets')).toBe('all')
    expect(activeAgentTab('/phase/agents/secrets/source-id')).toBe('all')
    expect(activeAgentTab('/phase/agents/policies')).toBe('all')
  })

  it('does not treat unrelated paths as canonical Agent tabs', () => {
    expect(activeAgentTab('/phase/ai-agents/requests')).toBe('')
    expect(activeAgentTab('/phase/apps')).toBe('')
    expect(activeAgentTab(null)).toBe('')
  })

  it('builds canonical Agent paths without duplicate separators', () => {
    expect(agentsPath('phase')).toBe('/phase/agents')
    expect(agentsPath('phase', 'all')).toBe('/phase/agents/all')
    expect(agentsPath('phase', 'requests')).toBe('/phase/agents/requests')
    expect(agentsPath('phase', '/agent-id/')).toBe('/phase/agents/agent-id')
  })

  it('returns from provider setup to the request setup action', () => {
    expect(agentRequestSetupPath('phase', 'request/id')).toBe(
      '/phase/agents/requests?request=request%2Fid&action=setup'
    )
  })
})
