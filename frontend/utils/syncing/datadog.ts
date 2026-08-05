export type DatadogSite = {
  site: string
  name: string
}

// Mirrors the backend allowlist in
// backend/ee/integrations/logs/streams/adapters/datadog.py (DATADOG_SITES) —
// keep the two in sync when Datadog adds a region.
export const datadogSites: DatadogSite[] = [
  { site: 'datadoghq.com', name: 'US1 (datadoghq.com)' },
  { site: 'us3.datadoghq.com', name: 'US3 (us3.datadoghq.com)' },
  { site: 'us5.datadoghq.com', name: 'US5 (us5.datadoghq.com)' },
  { site: 'datadoghq.eu', name: 'EU1 (datadoghq.eu)' },
  { site: 'ap1.datadoghq.com', name: 'AP1 (ap1.datadoghq.com)' },
  { site: 'ap2.datadoghq.com', name: 'AP2 (ap2.datadoghq.com)' },
  { site: 'ddog-gov.com', name: 'US1-FED (ddog-gov.com)' },
]
