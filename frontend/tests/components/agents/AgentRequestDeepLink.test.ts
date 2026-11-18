import {
  agentRequestAnchorId,
  isAgentRequestFulfillmentDeepLink,
  prioritiseAgentRequest,
} from '@/components/agents/AgentRequestDeepLink'

describe('Agent request deep links', () => {
  test('moves the linked request to the front without mutating the input', () => {
    const requests = [{ id: 'one' }, { id: 'two' }]
    expect(prioritiseAgentRequest(requests, 'two').map(({ id }) => id)).toEqual(['two', 'one'])
    expect(requests.map(({ id }) => id)).toEqual(['one', 'two'])
  })

  test('supports setup links only', () => {
    expect(isAgentRequestFulfillmentDeepLink('one', 'setup', 'one')).toBe(true)
    expect(isAgentRequestFulfillmentDeepLink('one', 'fulfill', 'one')).toBe(false)
    expect(isAgentRequestFulfillmentDeepLink('one', 'deposit', 'one')).toBe(false)
    expect(isAgentRequestFulfillmentDeepLink('two', 'setup', 'one')).toBe(false)
  })

  test('creates a stable request anchor', () => {
    expect(agentRequestAnchorId('request-1')).toBe('agent-request-request-1')
  })
})
