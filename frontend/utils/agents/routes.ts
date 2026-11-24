export const AGENTS_ROUTE_SEGMENT = 'agents'

export const REQUESTS_ROUTE_SEGMENT = 'requests'

export const AGENT_TAB_SEGMENTS = ['all', 'connections'] as const

/** `''` is the Overview mesh at the section index. */
export type AgentTabSegment = '' | (typeof AGENT_TAB_SEGMENTS)[number]

export function agentsPath(team: string, suffix = ''): string {
  const normalizedSuffix = suffix.replace(/^\/+|\/+$/g, '')
  return `/${team}/${AGENTS_ROUTE_SEGMENT}${normalizedSuffix ? `/${normalizedSuffix}` : ''}`
}

/** Requests are a top-level section, not an Agents tab. */
export function requestsPath(team: string): string {
  return `/${team}/${REQUESTS_ROUTE_SEGMENT}`
}

export function agentRequestPath(team: string, requestId: string): string {
  return `${requestsPath(team)}?${new URLSearchParams({ request: requestId })}`
}

export function agentRequestSetupPath(team: string, requestId: string): string {
  const query = new URLSearchParams({ request: requestId, action: 'setup' })
  return `${requestsPath(team)}?${query}`
}

/**
 * Where a link to the old Agents Requests tab goes now. Old links keep their query string
 * whole, repeated parameters included.
 */
export function requestsRedirectPath(
  team: string,
  search?: string | URLSearchParams | null
): string {
  const query = typeof search === 'string' ? search.replace(/^\?/, '') : search?.toString() || ''
  return query ? `${requestsPath(team)}?${query}` : requestsPath(team)
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
