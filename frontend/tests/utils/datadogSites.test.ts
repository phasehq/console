import { datadogSites } from '@/utils/syncing/datadog'

describe('datadogSites', () => {
  test('covers every Datadog region including UK1 and US2-FED', () => {
    const sites = datadogSites.map((s) => s.site)
    expect(sites).toEqual([
      'datadoghq.com',
      'us3.datadoghq.com',
      'us5.datadoghq.com',
      'datadoghq.eu',
      'uk1.datadoghq.com',
      'ap1.datadoghq.com',
      'ap2.datadoghq.com',
      'ddog-gov.com',
      'us2.ddog-gov.com',
    ])
  })

  test('first entry is the US1 default seeded by CreateProviderCredentials', () => {
    // handleProviderChange seeds credentials.site from datadogSites[0] —
    // reordering the list silently changes the default region new
    // credentials are saved with.
    expect(datadogSites[0].site).toBe('datadoghq.com')
  })
})
