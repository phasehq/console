import { ApiAuditEventResourceTypeChoices, AuditEventType } from '@/apollo/graphql'

/** Audit log JSON fields arrive as JSON strings; parse them leniently. */
export const parseJsonField = (val: any): Record<string, any> | null => {
  if (!val) return null
  if (typeof val === 'object') return val
  try {
    return JSON.parse(val)
  } catch {
    return null
  }
}

/** Build a link to the resource if possible */
export const getResourceLink = (
  log: AuditEventType,
  resourceMeta: Record<string, any> | null,
  team: string
): string | null => {
  // Don't link to deleted resources
  if (log.eventType === 'D') return null

  const rt = log.resourceType
  const id = log.resourceId

  if (rt === ApiAuditEventResourceTypeChoices.App) return `/${team}/apps/${id}`
  if (rt === ApiAuditEventResourceTypeChoices.Env && resourceMeta?.app_id)
    return `/${team}/apps/${resourceMeta.app_id}/environments/${id}`
  if (rt === ApiAuditEventResourceTypeChoices.Role) return `/${team}/access/roles`
  if (rt === ApiAuditEventResourceTypeChoices.Org) return `/${team}/settings?tab=organisation`
  if (rt === ApiAuditEventResourceTypeChoices.Sa) return `/${team}/access/service-accounts/${id}`
  if (rt === ApiAuditEventResourceTypeChoices.Member) return `/${team}/access/members/${id}`
  if (rt === ApiAuditEventResourceTypeChoices.Team) return `/${team}/access/teams/${id}`
  if (rt === ApiAuditEventResourceTypeChoices.Policy) return `/${team}/access/network`
  if (rt === ApiAuditEventResourceTypeChoices.Pat) return `/${team}/access/authentication`
  if (rt === ApiAuditEventResourceTypeChoices.SaToken && resourceMeta?.service_account_id)
    return `/${team}/access/service-accounts/${resourceMeta.service_account_id}`
  if (rt === ApiAuditEventResourceTypeChoices.SvcToken && resourceMeta?.app_id)
    return `/${team}/apps/${resourceMeta.app_id}`
  if (
    rt === ApiAuditEventResourceTypeChoices.Rs &&
    resourceMeta?.app_id &&
    resourceMeta?.environment_id
  )
    return `/${team}/apps/${resourceMeta.app_id}/environments/${resourceMeta.environment_id}`
  if (rt === ApiAuditEventResourceTypeChoices.Stream) return `/${team}/integrations/log-streams`

  return null
}
