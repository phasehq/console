import React from 'react'
import { createRoot, Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import axios from 'axios'

import { UserProvider, useUser } from '@/contexts/userContext'

jest.mock('axios')
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}))

const mockedAxios = axios as jest.Mocked<typeof axios>
const { usePathname } = jest.requireMock('next/navigation') as {
  usePathname: jest.Mock
}

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

function Consumer() {
  const { loading, error, user } = useUser()
  return React.createElement('div', {
    'data-loading': String(loading),
    'data-error': String(error),
    'data-email': user?.email ?? '',
  })
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('UserProvider', () => {
  let container: HTMLDivElement
  let root: Root
  let originalLocation: Location

  beforeEach(() => {
    process.env.NEXT_PUBLIC_BACKEND_API_BASE = 'https://app.phase.dev/service'
    usePathname.mockReturnValue('/acme/settings')
    mockedAxios.get.mockReset()
    mockedAxios.isAxiosError.mockReset()
    mockedAxios.isAxiosError.mockReturnValue(true)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        href: 'http://localhost/acme/settings',
        pathname: '/acme/settings',
        search: '',
      },
    })
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
    jest.clearAllMocks()
  })

  it('does not redirect to login on transient backend failures', async () => {
    mockedAxios.get.mockRejectedValue({ response: { status: 500 } })

    await act(async () => {
      root.render(React.createElement(UserProvider, null, React.createElement(Consumer)))
    })
    await flushEffects()

    const content = container.firstElementChild as HTMLElement
    expect(content.dataset.loading).toBe('false')
    expect(content.dataset.error).toBe('true')
    expect(window.location.href).toBe('http://localhost/acme/settings')
  })

  it('redirects to /login with callbackUrl when session expires on a deep link', async () => {
    mockedAxios.get.mockRejectedValue({ response: { status: 401 } })

    await act(async () => {
      root.render(React.createElement(UserProvider, null, React.createElement(Consumer)))
    })
    await flushEffects()

    expect(window.location.href).toBe('/login?callbackUrl=%2Facme%2Fsettings')
  })

  it('redirects to clean /login when session expires on the root path', async () => {
    usePathname.mockReturnValue('/')
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/', pathname: '/', search: '' },
    })

    mockedAxios.get.mockRejectedValue({ response: { status: 403 } })

    await act(async () => {
      root.render(React.createElement(UserProvider, null, React.createElement(Consumer)))
    })
    await flushEffects()

    // Root path should not append a callbackUrl — clean /login
    expect(window.location.href).toBe('/login')
  })

  it('preserves query string in callbackUrl', async () => {
    usePathname.mockReturnValue('/acme/settings')
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        href: 'http://localhost/acme/settings?tab=account',
        pathname: '/acme/settings',
        search: '?tab=account',
      },
    })

    mockedAxios.get.mockRejectedValue({ response: { status: 401 } })

    await act(async () => {
      root.render(React.createElement(UserProvider, null, React.createElement(Consumer)))
    })
    await flushEffects()

    expect(window.location.href).toBe(
      '/login?callbackUrl=%2Facme%2Fsettings%3Ftab%3Daccount'
    )
  })

  it('does not redirect on public paths', async () => {
    usePathname.mockReturnValue('/login')

    mockedAxios.get.mockRejectedValue({ response: { status: 401 } })

    await act(async () => {
      root.render(React.createElement(UserProvider, null, React.createElement(Consumer)))
    })
    await flushEffects()

    // Should stay on login, not redirect
    expect(window.location.href).not.toContain('/login?callbackUrl=')
  })

  it('does not redirect on /signup (public path for registration)', async () => {
    usePathname.mockReturnValue('/signup')
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        href: 'http://localhost/signup',
        pathname: '/signup',
        search: '',
      },
    })

    mockedAxios.get.mockRejectedValue({ response: { status: 403 } })

    await act(async () => {
      root.render(React.createElement(UserProvider, null, React.createElement(Consumer)))
    })
    await flushEffects()

    // Should stay on signup, not redirect to login
    expect(window.location.href).toBe('http://localhost/signup')
  })
})
