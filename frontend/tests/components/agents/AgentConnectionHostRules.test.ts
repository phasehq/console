import {
  agentHostRulesRequireIndependentReview,
  configuredAgentDatabase,
  configuredAgentHostRules,
  isRequiredAgentEndpoint,
  presentAgentHostRule,
  showAgentConnectionEndpointDetails,
} from '@/components/agents/AgentConnectionHostRules'

describe('Agent connection host-rule modes', () => {
  const endpoint = [{ match: 'exact', value: 'database.internal', port: 5432 }]

  test('treats required endpoints as normal connection configuration', () => {
    expect(isRequiredAgentEndpoint('required_endpoint')).toBe(true)
    expect(agentHostRulesRequireIndependentReview('required_endpoint', { hosts: endpoint })).toBe(
      false
    )
  })

  test('requires four-eyes review only for configured optional overrides', () => {
    expect(agentHostRulesRequireIndependentReview('optional_override', { hosts: endpoint })).toBe(
      true
    )
    expect(agentHostRulesRequireIndependentReview('optional_override', { hosts: [] })).toBe(false)
  })

  test('keeps unknown template modes fail closed and safely reads malformed config', () => {
    expect(agentHostRulesRequireIndependentReview(undefined, { hosts: endpoint })).toBe(true)
    expect(configuredAgentHostRules(null)).toEqual([])
    expect(configuredAgentHostRules({ hosts: 'not-an-array' })).toEqual([])
  })

  test('presents connection routing without exposing raw configuration JSON', () => {
    expect(presentAgentHostRule({ match: 'exact', value: 'localhost', port: 1337 })).toEqual({
      endpoint: 'localhost:1337',
      matchLabel: 'Exact host',
    })
    expect(presentAgentHostRule({ match: 'suffix', value: '.amazonaws.com', port: 443 })).toEqual({
      endpoint: '*.amazonaws.com:443',
      matchLabel: 'Domain and subdomains',
    })
    expect(presentAgentHostRule({ match: 'exact', value: '::1', port: 5432 })).toEqual({
      endpoint: '[::1]:5432',
      matchLabel: 'Exact host',
    })
    expect(presentAgentHostRule({ match: 'exact', value: '' })).toBeNull()
    expect(configuredAgentDatabase({ database: ' phase ' })).toBe('phase')
    expect(configuredAgentDatabase({ database: 42 })).toBeNull()
  })

  test('keeps PostgreSQL endpoint details out of the Connections overview', () => {
    expect(showAgentConnectionEndpointDetails('postgres', { hosts: endpoint })).toBe(false)
    expect(showAgentConnectionEndpointDetails('PostgreSQL', { hosts: endpoint })).toBe(false)
    expect(showAgentConnectionEndpointDetails('custom-service', { hosts: endpoint })).toBe(true)
    expect(showAgentConnectionEndpointDetails('custom-service', { hosts: [] })).toBe(false)
  })
})
