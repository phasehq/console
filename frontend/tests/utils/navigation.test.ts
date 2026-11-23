import { ACCESS_PAGES, getIntegrationPages } from '@/utils/navigation'

describe('section pages', () => {
  it('lists Log Streams only when the role can read them', () => {
    expect(getIntegrationPages(false).map((page) => page.link)).toEqual([
      'syncs',
      'dynamic-secrets',
      'credentials',
    ])
    expect(getIntegrationPages(true).map((page) => page.link)).toEqual([
      'syncs',
      'dynamic-secrets',
      'log-streams',
      'credentials',
    ])
  })

  it('gives every access page a unique link', () => {
    const links = ACCESS_PAGES.map((page) => page.link)
    expect(new Set(links).size).toBe(links.length)
  })
})
