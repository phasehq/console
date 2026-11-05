import { humanizeAgentValue } from '@/components/agents/AgentUI'

describe('humanizeAgentValue', () => {
  test('uses the user-facing App secrets name for App-backed credentials', () => {
    expect(humanizeAgentValue('APP_SECRET')).toBe('App secrets')
    expect(humanizeAgentValue('app_secret')).toBe('App secrets')
  })

  test('keeps brand and acronym spellings', () => {
    expect(humanizeAgentValue('aws')).toBe('AWS')
    expect(humanizeAgentValue('AWS_ASSUME_ROLE')).toBe('AWS Assume Role')
    expect(humanizeAgentValue('postgres')).toBe('PostgreSQL')
    expect(humanizeAgentValue('aws_sigv4')).toBe('AWS SigV4')
    expect(humanizeAgentValue('pg_query')).toBe('PostgreSQL Query')
  })

  test('continues to humanize other enum values', () => {
    expect(humanizeAgentValue('REQUEST_APPROVAL')).toBe('Request Approval')
    expect(humanizeAgentValue(null)).toBe('Unknown')
  })
})
