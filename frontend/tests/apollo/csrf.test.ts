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

const apiBase = 'https://console.example.com/service'
const { Response, Headers } = jest.requireActual('cross-fetch')
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const csrfError = { error: 'CSRF verification failed.', code: 'csrf_failed' }
const csrfFailure = () => jsonResponse(csrfError, 403)

describe('CSRF request handling', () => {
  let fetchMock: jest.Mock
  let axiosMock: { post: jest.Mock }
  let clientModule: typeof import('@/apollo/client')
  const originalLocation = window.location

  beforeEach(() => {
    jest.resetModules()
    process.env.NEXT_PUBLIC_BACKEND_API_BASE = apiBase
    fetchMock = require('cross-fetch').default
    axiosMock = require('axios').default
    axiosMock.post.mockResolvedValue({ data: {} })
    fetchMock.mockResolvedValue(jsonResponse({ csrfToken: 'initial-token' }))
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '/account', pathname: '/account', search: '' },
    })
    jest.spyOn(console, 'log').mockImplementation(() => {})
    clientModule = require('@/apollo/client')
  })

  afterEach(() => {
    clientModule.graphQlClient.stop()
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    jest.restoreAllMocks()
  })

  const graphqlCalls = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/graphql/'))
  const tokenCalls = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/csrf/'))
  const mutate = () => {
    const { gql } = require('@apollo/client')
    return clientModule.graphQlClient.mutate({
      mutation: gql`
        mutation CsrfSmoke {
          __typename
        }
      `,
    })
  }

  test('eagerly fetches and shares the initial token request with browser cookies', async () => {
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const first = clientModule.getCsrfToken()
    expect(clientModule.getCsrfToken()).toBe(first)
    await expect(first).resolves.toBe('initial-token')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`${apiBase}/auth/csrf/`, { credentials: 'include' })
  })

  test.each(['network', 'http', 'empty', 'invalid-json'])(
    'does not cache a failed token fetch: %s',
    async (failure) => {
      await clientModule.getCsrfToken()
      if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('Offline'))
      if (failure === 'http') fetchMock.mockResolvedValueOnce(jsonResponse({}, 503))
      if (failure === 'empty') fetchMock.mockResolvedValueOnce(jsonResponse({}))
      if (failure === 'invalid-json') fetchMock.mockResolvedValueOnce(new Response('not JSON'))
      fetchMock.mockResolvedValueOnce(jsonResponse({ csrfToken: 'recovered-token' }))
      await expect(clientModule.refreshCsrfToken()).resolves.toBe('')
      await expect(clientModule.getCsrfToken()).resolves.toBe('recovered-token')
      expect(tokenCalls()).toHaveLength(3)
    }
  )

  test('attaches the token to GraphQL mutations', async () => {
    await clientModule.getCsrfToken()
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { __typename: 'Mutation' } }))
    await expect(mutate()).resolves.toMatchObject({ data: { __typename: 'Mutation' } })
    const [, options] = graphqlCalls()[0]
    expect(new Headers(options.headers).get('X-CSRFToken')).toBe('initial-token')
    expect(options.credentials).toBe('include')
    expect(tokenCalls()).toHaveLength(1)
  })

  test('refreshes and retries a JSON CSRF failure without logging out', async () => {
    await clientModule.getCsrfToken()
    fetchMock
      .mockResolvedValueOnce(csrfFailure())
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'fresh-token' }))
      .mockResolvedValueOnce(jsonResponse({ data: { __typename: 'Mutation' } }))
    await expect(mutate()).resolves.toMatchObject({ data: { __typename: 'Mutation' } })
    expect(graphqlCalls()).toHaveLength(2)
    expect(tokenCalls()).toHaveLength(2)
    expect(new Headers(graphqlCalls()[1][1].headers).get('X-CSRFToken')).toBe('fresh-token')
    expect(axiosMock.post).not.toHaveBeenCalled()
    expect(window.location.href).toBe('/account')
  })

  test('retries only once and still delivers persistent failures to the global handler', async () => {
    await clientModule.getCsrfToken()
    fetchMock
      .mockResolvedValueOnce(csrfFailure())
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'fresh-token' }))
      .mockResolvedValueOnce(csrfFailure())
    await expect(mutate()).rejects.toThrow('403')
    expect(graphqlCalls()).toHaveLength(2)
    expect(tokenCalls()).toHaveLength(2)
    expect(axiosMock.post).toHaveBeenCalledTimes(1)
  })

  test.each(['permission', 'html', 'null'])(
    'does not refresh or retry a 403 without the CSRF error code: %s',
    async (failure) => {
      await clientModule.getCsrfToken()
      const response =
        failure === 'html'
          ? new Response('<html>CSRF verification failed.</html>', {
              status: 403,
              headers: { 'Content-Type': 'text/html' },
            })
          : jsonResponse(
              failure === 'null' ? null : { code: 'forbidden', error: 'CSRF is not the cause.' },
              403
            )
      fetchMock.mockResolvedValueOnce(response)
      await expect(mutate()).rejects.toThrow('403')
      expect(graphqlCalls()).toHaveLength(1)
      expect(tokenCalls()).toHaveLength(1)
    }
  )

  test('logout refreshes a stale token and retries before redirecting', async () => {
    await clientModule.getCsrfToken()
    axiosMock.post.mockRejectedValueOnce({ response: { status: 403, data: csrfError } })
    fetchMock.mockResolvedValueOnce(jsonResponse({ csrfToken: 'fresh-token' }))
    await clientModule.handleSignout()
    expect(axiosMock.post).toHaveBeenCalledTimes(2)
    expect(axiosMock.post.mock.calls[1][2].headers['X-CSRFToken']).toBe('fresh-token')
    expect(window.location.href).toBe('/login')
  })

  test('logout retries a persistent CSRF failure only once and still redirects', async () => {
    await clientModule.getCsrfToken()
    axiosMock.post.mockRejectedValue({ response: { status: 403, data: csrfError } })
    fetchMock.mockResolvedValueOnce(jsonResponse({ csrfToken: 'fresh-token' }))
    await clientModule.handleSignout()
    expect(axiosMock.post).toHaveBeenCalledTimes(2)
    expect(tokenCalls()).toHaveLength(2)
    expect(window.location.href).toBe('/login')
  })

  test.each([
    { status: 403, data: { code: 'forbidden' } },
    { status: 400, data: csrfError },
  ])('logout does not retry other errors: %j', async (response) => {
    await clientModule.getCsrfToken()
    axiosMock.post.mockRejectedValueOnce({ response })
    await clientModule.handleSignout()
    expect(axiosMock.post).toHaveBeenCalledTimes(1)
    expect(tokenCalls()).toHaveLength(1)
    expect(window.location.href).toBe('/login')
  })
})
