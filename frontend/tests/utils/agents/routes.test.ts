import {
  activeAgentTab,
  agentRequestPath,
  agentRequestSetupPath,
  agentsPath,
  requestsPath,
  requestsRedirectPath,
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
    // Requests are no longer an Agents tab; the old path only redirects.
    expect(activeAgentTab('/phase/agents/requests')).toBe('all')
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

  it('puts Requests in the main navigation, outside the Agents section', () => {
    expect(requestsPath('phase')).toBe('/phase/requests')
    expect(agentRequestPath('phase', 'request-1')).toBe('/phase/requests?request=request-1')
    expect(agentRequestPath('phase', 'request/id')).toBe('/phase/requests?request=request%2Fid')
  })

  it('returns from provider setup to the request setup action', () => {
    expect(agentRequestSetupPath('phase', 'request/id')).toBe(
      '/phase/requests?request=request%2Fid&action=setup'
    )
  })
})

describe('the old Agents Requests path', () => {
  it('redirects to the Requests section', () => {
    expect(requestsRedirectPath('phase')).toBe('/phase/requests')
    expect(requestsRedirectPath('phase', null)).toBe('/phase/requests')
    expect(requestsRedirectPath('phase', '')).toBe('/phase/requests')
    expect(requestsRedirectPath('phase', new URLSearchParams())).toBe('/phase/requests')
  })

  it('keeps an approval link working, query string and all', () => {
    // The URL the backend hands an Agent for every request kind.
    expect(
      requestsRedirectPath('phase', new URLSearchParams('request=request-1&action=setup'))
    ).toBe('/phase/requests?request=request-1&action=setup')
    expect(requestsRedirectPath('phase', '?request=request-1&action=setup')).toBe(
      '/phase/requests?request=request-1&action=setup'
    )
    expect(requestsRedirectPath('phase', 'request=request-1')).toBe(
      '/phase/requests?request=request-1'
    )
  })

  it('keeps encoded values, repeated parameters and their order', () => {
    const search = new URLSearchParams()
    search.append('request', 'a/b c')
    search.append('tag', 'one')
    search.append('tag', 'two')
    search.append('action', 'setup')
    const target = requestsRedirectPath('acme', search)

    expect(target.startsWith('/acme/requests?')).toBe(true)
    const kept = new URLSearchParams(target.split('?')[1])
    expect(kept.get('request')).toBe('a/b c')
    expect(kept.getAll('tag')).toEqual(['one', 'two'])
    expect(Array.from(kept.keys())).toEqual(['request', 'tag', 'tag', 'action'])
  })
})
