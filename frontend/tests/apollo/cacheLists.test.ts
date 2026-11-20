export {}

jest.mock('cross-fetch', () => ({
  ...jest.requireActual('cross-fetch'),
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn(), isAxiosError: jest.fn(() => true) },
}))
jest.mock('posthog-js', () => ({ __esModule: true, default: { reset: jest.fn() } }))
jest.mock('react-toastify', () => ({ toast: { error: jest.fn() } }))

/**
 * A list that loses a row: an App or Environment was scheduled for deletion,
 * restored or deleted. When the shorter list arrives from a poll or a page
 * load, the cache must take it as it is, without Apollo's "Cache data may be
 * lost" warning.
 */
describe('cached lists that lose a row', () => {
  let clientModule: typeof import('@/apollo/client')
  let gql: typeof import('@apollo/client').gql
  let warn: jest.SpyInstance

  beforeEach(() => {
    // Apollo warns once per field: a fresh copy per test keeps them independent.
    jest.resetModules()
    process.env.NEXT_PUBLIC_BACKEND_API_BASE = 'https://console.example.com/service'
    const { Response } = jest.requireActual('cross-fetch')
    require('cross-fetch').default.mockResolvedValue(
      new Response(JSON.stringify({ csrfToken: 'token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    jest.spyOn(console, 'log').mockImplementation(() => {})
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    clientModule = require('@/apollo/client')
    gql = require('@apollo/client').gql
  })

  afterEach(() => {
    clientModule.graphQlClient.stop()
    jest.restoreAllMocks()
  })

  const cache = () => clientModule.graphQlClient.cache

  const pendingApps = () => gql`
    query PendingApps($organisationId: ID!) {
      deletedApps(organisationId: $organisationId) {
        id
        name
      }
    }
  `

  const pendingEnvironments = () => gql`
    query PendingEnvironments($appId: ID!) {
      deletedEnvironments(appId: $appId) {
        id
        name
      }
    }
  `

  it.each([
    ['deletedApps', 'DeletedAppType', pendingApps, { organisationId: 'org-1' }],
    ['deletedEnvironments', 'DeletedEnvironmentType', pendingEnvironments, { appId: 'app-1' }],
  ])('replaces %s with the shorter list', (field, typename, document, variables) => {
    const query = document()
    const row = (id: string) => ({ __typename: typename, id, name: id })

    // As a poll writes its result. An explicit refetch overwrites, and never warns.
    cache().writeQuery({ query, variables, data: { [field]: [row('a'), row('b')] } })
    cache().writeQuery({ query, variables, data: { [field]: [row('b')] } })
    expect(cache().readQuery({ query, variables })).toEqual({ [field]: [row('b')] })

    cache().writeQuery({ query, variables, data: { [field]: [] } })
    expect(cache().readQuery({ query, variables })).toEqual({ [field]: [] })

    expect(warn).not.toHaveBeenCalled()
  })

  it("replaces an App's environments with the shorter list", () => {
    const query = gql`
      query Apps($organisationId: ID) {
        apps(organisationId: $organisationId) {
          id
          environments {
            id
            name
          }
        }
      }
    `
    const variables = { organisationId: 'org-1' }
    const environment = (id: string) => ({ __typename: 'EnvironmentType', id, name: id })
    const app = (environments: ReturnType<typeof environment>[]) => ({
      apps: [{ __typename: 'AppType', id: 'app-1', environments }],
    })

    cache().writeQuery({ query, variables, data: app([environment('dev'), environment('prod')]) })
    // One of them was scheduled for deletion since.
    cache().writeQuery({ query, variables, data: app([environment('dev')]) })

    expect(cache().readQuery({ query, variables })).toEqual(app([environment('dev')]))
    expect(warn).not.toHaveBeenCalled()
  })
})
