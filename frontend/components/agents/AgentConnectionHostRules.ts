export type AgentHostRulesMode = 'required_endpoint' | 'optional_override'

export type AgentHostRulePresentation = {
  endpoint: string
  matchLabel: string
}

export const configuredAgentHostRules = (config: unknown): unknown[] => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return []
  const hosts = (config as Record<string, unknown>).hosts
  return Array.isArray(hosts) ? hosts : []
}

export const presentAgentHostRule = (rule: unknown): AgentHostRulePresentation | null => {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null

  const { match, value, port } = rule as Record<string, unknown>
  if (typeof value !== 'string' || !value.trim()) return null

  const normalizedHost = value.trim()
  const displayHost =
    match === 'suffix'
      ? `*${normalizedHost.startsWith('.') ? normalizedHost : `.${normalizedHost}`}`
      : normalizedHost.includes(':') && !normalizedHost.startsWith('[')
        ? `[${normalizedHost}]`
        : normalizedHost
  const normalizedPort =
    typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null

  return {
    endpoint: normalizedPort ? `${displayHost}:${normalizedPort}` : displayHost,
    matchLabel:
      match === 'exact' ? 'Exact host' : match === 'suffix' ? 'Domain and subdomains' : 'Host',
  }
}

export const configuredAgentDatabase = (config: unknown): string | null => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null
  const database = (config as Record<string, unknown>).database
  return typeof database === 'string' && database.trim() ? database.trim() : null
}

export const isRequiredAgentEndpoint = (mode?: AgentHostRulesMode | null) =>
  mode === 'required_endpoint'

// An unknown mode retains the safer existing review UI until the template
// contract is available. Only an explicit required_endpoint bypasses review.
export const agentHostRulesRequireIndependentReview = (
  mode: AgentHostRulesMode | null | undefined,
  config: unknown
) => configuredAgentHostRules(config).length > 0 && !isRequiredAgentEndpoint(mode)

export const showAgentConnectionEndpointDetails = (serviceType: string, config: unknown) =>
  !serviceType.toLowerCase().includes('postgres') && configuredAgentHostRules(config).length > 0
