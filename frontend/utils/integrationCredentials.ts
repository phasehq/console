export type IntegrationCredentialSummary = {
  id: string
  name: string
  revision?: string | null
  provider?: {
    id: string
    name: string
  } | null
  createdAt?: string | null
  updatedAt?: string | null
  syncCount?: number | null
  agentConnectionCount?: number | null
}

export type IntegrationCredentialGroup<T extends IntegrationCredentialSummary> = {
  id: string
  name: string
  credentials: T[]
  credentialCount: number
  usageCount: number
  syncCount: number
  agentConnectionCount: number
  createdAt: string | null
  updatedAt: string | null
}

const AWS_PROVIDER_IDS = new Set(['aws', 'aws_assume_role'])

export const canonicalIntegrationId = (providerId?: string | null) => {
  const normalized = providerId?.trim().toLowerCase()

  if (!normalized) return 'unknown'
  return AWS_PROVIDER_IDS.has(normalized) ? 'aws' : normalized
}

export const integrationCredentialHref = (
  team: string,
  credential: Pick<IntegrationCredentialSummary, 'id' | 'provider'>
) => {
  const params = new URLSearchParams({
    provider: canonicalIntegrationId(credential.provider?.id),
    credential: credential.id,
  })

  return `/${encodeURIComponent(team)}/integrations?${params.toString()}`
}

const timestamp = (value?: string | null) => {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

export const groupIntegrationCredentials = <T extends IntegrationCredentialSummary>(
  credentials: T[]
): IntegrationCredentialGroup<T>[] => {
  const grouped = new Map<string, IntegrationCredentialGroup<T>>()

  credentials.forEach((credential) => {
    const id = canonicalIntegrationId(credential.provider?.id)
    const existing = grouped.get(id)
    const syncCount = credential.syncCount ?? 0
    const agentConnectionCount = credential.agentConnectionCount ?? 0
    const createdAt = credential.createdAt ?? null
    const updatedAt = credential.updatedAt ?? credential.createdAt ?? null

    if (!existing) {
      grouped.set(id, {
        id,
        name: id === 'aws' ? 'AWS' : credential.provider?.name || 'Unknown integration',
        credentials: [credential],
        credentialCount: 1,
        usageCount: syncCount + agentConnectionCount,
        syncCount,
        agentConnectionCount,
        createdAt,
        updatedAt,
      })
      return
    }

    existing.credentials.push(credential)
    existing.credentialCount += 1
    existing.syncCount += syncCount
    existing.agentConnectionCount += agentConnectionCount
    existing.usageCount += syncCount + agentConnectionCount

    const currentCreated = timestamp(existing.createdAt)
    const candidateCreated = timestamp(createdAt)
    if (
      candidateCreated !== null &&
      (currentCreated === null || candidateCreated < currentCreated)
    ) {
      existing.createdAt = createdAt
    }

    const currentUpdated = timestamp(existing.updatedAt)
    const candidateUpdated = timestamp(updatedAt)
    if (
      candidateUpdated !== null &&
      (currentUpdated === null || candidateUpdated > currentUpdated)
    ) {
      existing.updatedAt = updatedAt
    }
  })

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      credentials: [...group.credentials].sort((left, right) => {
        const rightDate = timestamp(right.updatedAt ?? right.createdAt) ?? 0
        const leftDate = timestamp(left.updatedAt ?? left.createdAt) ?? 0
        return rightDate - leftDate || left.name.localeCompare(right.name)
      }),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export const integrationMatchesSearch = <T extends IntegrationCredentialSummary>(
  group: IntegrationCredentialGroup<T>,
  query: string
) => {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  return (
    group.name.toLowerCase().includes(normalized) ||
    group.credentials.some((credential) => credential.name.toLowerCase().includes(normalized))
  )
}
