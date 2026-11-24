import { generatePageTitle } from '@/utils/navigation'
import { parseRoute } from '@/utils/route'

jest.mock('next/navigation', () => ({ useParams: jest.fn(), usePathname: jest.fn() }))

describe('parseRoute', () => {
  it("reads one of an app's pages, and what is under it", () => {
    expect(parseRoute('/acme/apps/app-1/syncing')).toEqual({
      context: 'apps',
      appId: 'app-1',
      page: 'syncing',
      subPage: undefined,
    })
    expect(parseRoute('/acme/apps/app-1/access/members')).toMatchObject({
      appId: 'app-1',
      page: 'access',
      subPage: 'members',
    })
  })

  it('takes what else follows an app for a folder of its secrets grid, not a page', () => {
    for (const pathname of [
      '/acme/apps/app-1',
      '/acme/apps/app-1/backend',
      '/acme/apps/app-1/backend/config',
      // A root folder named like a page opens behind the escape
      '/acme/apps/app-1/~/settings',
    ])
      expect(parseRoute(pathname)).toEqual({
        context: 'apps',
        appId: 'app-1',
        page: undefined,
        subPage: undefined,
      })
  })

  it('reads the pages of the other sections', () => {
    expect(parseRoute('/acme/access/members')).toEqual({
      context: 'access',
      appId: undefined,
      page: 'members',
      subPage: undefined,
    })
    expect(parseRoute('/acme/integrations/credentials/new')).toMatchObject({
      context: 'integrations',
      page: 'credentials',
      subPage: 'new',
    })
    expect(parseRoute(null)).toEqual({
      context: undefined,
      appId: undefined,
      page: undefined,
      subPage: undefined,
    })
  })

  it("titles a folder of the grid as the app's home", () => {
    const activeApp = { id: 'app-1', name: 'storefront' } as never
    const title = (pathname: string) =>
      generatePageTitle({ team: 'acme', ...parseRoute(pathname), activeApp })

    expect(title('/acme/apps/app-1')).toBe('Storefront · acme | Phase Console')
    expect(title('/acme/apps/app-1/~/settings')).toBe(title('/acme/apps/app-1'))
    expect(title('/acme/apps/app-1/backend/config')).toBe(title('/acme/apps/app-1'))
    expect(title('/acme/apps/app-1/settings')).toBe('Settings · Storefront · acme | Phase Console')
  })
})
