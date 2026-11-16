import { appFolderRoute, appSecretsUrl, foldersFromRoute } from '@/utils/appLinks'

describe('appSecretsUrl', () => {
  it("links to the app's grid", () => {
    expect(appSecretsUrl('acme', 'app-1')).toBe('/acme/apps/app-1')
  })

  it('narrows the grid to one env', () => {
    expect(appSecretsUrl('acme', 'app-1', { envId: 'env-1' })).toBe('/acme/apps/app-1?envs=env-1')
  })

  it('opens a folder, with or without surrounding slashes', () => {
    expect(appSecretsUrl('acme', 'app-1', { envId: 'env-1', path: '/backend/api' })).toBe(
      '/acme/apps/app-1/backend/api?envs=env-1'
    )
    expect(appSecretsUrl('acme', 'app-1', { envId: 'env-1', path: 'backend/api/' })).toBe(
      '/acme/apps/app-1/backend/api?envs=env-1'
    )
  })

  it('treats the root folder as no folder', () => {
    expect(appSecretsUrl('acme', 'app-1', { path: '/' })).toBe('/acme/apps/app-1')
  })

  it('points at a secret', () => {
    expect(
      appSecretsUrl('acme', 'app-1', { envId: 'env-1', path: '/backend', secretId: 'secret-9' })
    ).toBe('/acme/apps/app-1/backend?envs=env-1&secret=secret-9')
  })
})

describe('folders named like one of the app pages', () => {
  it('go behind ~ so the grid opens and not the page', () => {
    expect(appSecretsUrl('acme', 'app-1', { path: '/settings' })).toBe(
      '/acme/apps/app-1/~/settings'
    )
    expect(
      appSecretsUrl('acme', 'app-1', { envId: 'env-1', path: '/Logs/api', secretId: 's-1' })
    ).toBe('/acme/apps/app-1/~/Logs/api?envs=env-1&secret=s-1')
  })

  it('only when the name is the first folder', () => {
    expect(appFolderRoute('/backend/settings')).toBe('/backend/settings')
    expect(appFolderRoute('/settings-old')).toBe('/settings-old')
  })

  it('leave the root and other folders as they were', () => {
    expect(appFolderRoute('/')).toBe('')
    expect(appFolderRoute(null)).toBe('')
    expect(appFolderRoute('/backend/api')).toBe('/backend/api')
  })

  it('read back from the URL without the ~', () => {
    expect(foldersFromRoute(['~', 'settings', 'smtp'])).toEqual(['settings', 'smtp'])
    expect(foldersFromRoute(['backend', 'api'])).toEqual(['backend', 'api'])
    expect(foldersFromRoute(undefined)).toEqual([])
  })

  it('escape a root folder named ~ itself, so it reads back whole', () => {
    expect(appFolderRoute('/~/keys')).toBe('/~/~/keys')
    expect(foldersFromRoute(['~', '~', 'keys'])).toEqual(['~', 'keys'])
    expect(appFolderRoute('/backend/~')).toBe('/backend/~')
  })
})
