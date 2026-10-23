export const AGENTS_ROUTE_SEGMENT = 'agents'

export const AGENT_TAB_SEGMENTS = ['all', 'connections', 'requests'] as const

/** `''` is the Overview mesh at the section index. */
export type AgentTabSegment = '' | (typeof AGENT_TAB_SEGMENTS)[number]

export function agentsPath(team: string, suffix = ''): string {
  const normalizedSuffix = suffix.replace(/^\/+|\/+$/g, '')
  return `/${team}/${AGENTS_ROUTE_SEGMENT}${normalizedSuffix ? `/${normalizedSuffix}` : ''}`
}

export function agentRequestSetupPath(team: string, requestId: string): string {
  const query = new URLSearchParams({ request: requestId, action: 'setup' })
  return `${agentsPath(team, 'requests')}?${query}`
}

export function activeAgentTab(pathname: string | null | undefined): AgentTabSegment {
  const segments = (pathname || '').split('/').filter(Boolean)
  const agentsIndex = segments.lastIndexOf(AGENTS_ROUTE_SEGMENT)
  if (agentsIndex < 0) return ''
  const childSegment = segments[agentsIndex + 1]
  if (!childSegment) return ''

  // Unknown child segments are Agent detail pages, which belong to the Agents
  // directory tab rather than the Overview mesh.
  return AGENT_TAB_SEGMENTS.find((segment) => segment === childSegment) || 'all'
}
