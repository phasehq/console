import { agentCardSurface, humanizeAgentValue } from '@/components/agents/AgentUI'

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

describe('agentCardSurface', () => {
  const classes = (...args: Parameters<typeof agentCardSurface>) =>
    agentCardSurface(...args).split(' ')

  test('is the shared card surface: its fill, a thin border and no shadow', () => {
    expect(classes()).toEqual([
      'rounded-xl',
      'border',
      'bg-zinc-100',
      'dark:bg-white/2.5',
      'border-neutral-500/20',
    ])
    expect(agentCardSurface()).not.toContain('shadow')
    // A border, not an inset ring, so a table inside cannot paint over it.
    expect(agentCardSurface()).not.toContain('ring')
  })

  test('keeps the selected and attention highlights', () => {
    expect(classes('selected')).toEqual(
      expect.arrayContaining(['border-emerald-500/50', 'ring-2', 'ring-emerald-500/10'])
    )
    expect(classes('attention')).toEqual(
      expect.arrayContaining(['border-amber-500/60', 'ring-2', 'ring-amber-500/15'])
    )
    expect(classes('attention')).not.toContain('border-neutral-500/20')
  })

  test('can be opaque in the page background, with one fill and never two', () => {
    const opaque = classes(false, { opaque: true })
    expect(opaque).toEqual(expect.arrayContaining(['bg-zinc-100', 'dark:bg-neutral-900']))
    expect(opaque.filter((name) => name.includes('bg-'))).toHaveLength(2)
    expect(classes('attention', { opaque: true })).toEqual(
      expect.arrayContaining(['dark:bg-neutral-900', 'border-amber-500/60'])
    )
  })
})
