import { humanizeAgentValue } from '@/components/agents/AgentUI'

describe('humanizeAgentValue', () => {
  test('uses the user-facing App secrets name for App-backed credentials', () => {
    expect(humanizeAgentValue('APP_SECRET')).toBe('App secrets')
    expect(humanizeAgentValue('app_secret')).toBe('App secrets')
  })

  test('continues to humanize other enum values', () => {
    expect(humanizeAgentValue('REQUEST_APPROVAL')).toBe('Request Approval')
    expect(humanizeAgentValue(null)).toBe('Unknown')
  })
})
