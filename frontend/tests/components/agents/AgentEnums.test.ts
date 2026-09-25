import {
  isAgentActive,
  isAgentRequestPending,
  normalizeAgentEnum,
} from '@/components/agents/AgentEnums'

describe('Agent enum helpers', () => {
  test('normalizes GraphQL string enums without depending on casing', () => {
    expect(normalizeAgentEnum(' pending ')).toBe('PENDING')
    expect(normalizeAgentEnum(null)).toBe('')
    expect(isAgentActive('active')).toBe(true)
    expect(isAgentRequestPending('PENDING')).toBe(true)
  })
})
