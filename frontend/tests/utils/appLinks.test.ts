import { appSecretsUrl } from '@/utils/appLinks'

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
