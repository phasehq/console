export type AgentRequestReference = { id: string }

export function prioritiseAgentRequest<T extends AgentRequestReference>(
  requests: T[],
  requestedId?: string | null
): T[] {
  const id = requestedId?.trim()
  if (!id) return requests

  const index = requests.findIndex((request) => request.id === id)
  if (index <= 0) return requests

  return [requests[index], ...requests.slice(0, index), ...requests.slice(index + 1)]
}

export function agentRequestAnchorId(requestId: string) {
  return `agent-request-${requestId}`
}

export function isAgentRequestFulfillmentDeepLink(
  requestedId: string | null | undefined,
  action: string | null | undefined,
  requestId: string
) {
  return (
    requestedId?.trim() === requestId &&
    action?.trim().toLowerCase() === 'setup'
  )
}
